#!/usr/bin/env python3
"""
train_td_conv.py — Phase B: fitted TD(lambda) training of the SPATIAL value net
on the GPU, from episodes collected by the JS harness.

Data:   sim/toolbench/reports/*.jsonl from `node sim/toolbench/learn.mjs collect`
        (one episode per line: {"xs": [{"f": [flat...], "b": [64 tile ints]}...], "y": 0|1})
Model:  one-hot board planes -> conv3x3(32) -> ReLU -> conv3x3(32) -> ReLU
        -> flatten ++ flat features -> fc(128) -> ReLU -> fc(1) -> sigmoid
Method: fitted TD(lambda) — per sweep, compute lambda-returns backward through
        each episode using a FROZEN copy of the net, then train on the soft
        targets (BCE, Adam). Same algorithm as learn.mjs fit-td, bigger model,
        GPU speed.
Export: plain-JSON weights consumable by sim/toolbench/nn.mjs (JS inference),
        plus parity test vectors. Verify with:
        node sim/toolbench/nn.mjs parity <out.json> <out.parity.json>

Usage (WSL, from repo root; needs torch — CUDA build recommended):
  python3 sim/toolbench/python/train_td_conv.py \
    --data sim/toolbench/reports/gate1-episodes.jsonl \
    --out  sim/toolbench/reports/learned-conv.json \
    [--sweeps 10] [--lambda 0.8] [--epochs-per-sweep 1] [--batch 4096]
"""

import argparse
import copy
import json
import random
import sys

import torch
import torch.nn as nn

TILE_PLANES = 10  # must match features.mjs TILE_PLANES
SIZE = 8


class ValueNet(nn.Module):
    def __init__(self, flat_dim, ch=32, hidden=128):
        super().__init__()
        self.conv1 = nn.Conv2d(TILE_PLANES, ch, 3, padding=1)
        self.conv2 = nn.Conv2d(ch, ch, 3, padding=1)
        self.fc1 = nn.Linear(ch * SIZE * SIZE + flat_dim, hidden)
        self.fc2 = nn.Linear(hidden, 1)
        self.relu = nn.ReLU()

    def forward(self, planes, flat):
        h = self.relu(self.conv1(planes))
        h = self.relu(self.conv2(h))
        h = torch.cat([h.flatten(1), flat], dim=1)
        h = self.relu(self.fc1(h))
        return torch.sigmoid(self.fc2(h)).squeeze(1)


def load_episodes(path):
    episodes = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if "xs" not in r or not r["xs"]:
                continue
            if "b" not in r["xs"][0]:
                sys.exit("episodes lack board tensors ('b') — recollect with the current learn.mjs")
            episodes.append(r)
    return episodes


def to_planes(b64s, device):
    idx = torch.tensor(b64s, dtype=torch.long, device=device)          # [N, 64]
    planes = torch.zeros(idx.shape[0], TILE_PLANES, 64, device=device)
    planes.scatter_(1, idx.unsqueeze(1), 1.0)
    return planes.view(-1, TILE_PLANES, SIZE, SIZE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sweeps", type=int, default=10)
    ap.add_argument("--lambda", dest="lam", type=float, default=0.8)
    ap.add_argument("--epochs-per-sweep", type=int, default=1)
    ap.add_argument("--batch", type=int, default=4096)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--ch", type=int, default=32)
    ap.add_argument("--hidden", type=int, default=128)
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))

    episodes = load_episodes(args.data)
    flat_dim = len(episodes[0]["xs"][0]["f"])
    n_samples = sum(len(e["xs"]) for e in episodes)
    print(f"{len(episodes)} episodes / {n_samples} afterstates, flat_dim={flat_dim}, lambda={args.lam}")

    # flatten to tensors; episode boundaries kept as (start, length, y)
    all_f, all_b, spans = [], [], []
    for e in episodes:
        spans.append((len(all_f), len(e["xs"]), float(e["y"])))
        for s in e["xs"]:
            all_f.append(s["f"])
            all_b.append(s["b"])
    F = torch.tensor(all_f, dtype=torch.float32, device=device)
    P = to_planes(all_b, device)

    net = ValueNet(flat_dim, args.ch, args.hidden).to(device)
    opt = torch.optim.Adam(net.parameters(), lr=args.lr)
    bce = nn.BCELoss()

    for sweep in range(args.sweeps):
        # lambda-returns from a frozen copy (batched inference)
        frozen = copy.deepcopy(net).eval()
        with torch.no_grad():
            V = torch.empty(n_samples, device=device)
            for i in range(0, n_samples, args.batch):
                V[i:i + args.batch] = frozen(P[i:i + args.batch], F[i:i + args.batch])
        G = torch.empty(n_samples, device=device)
        for start, length, y in spans:
            G[start + length - 1] = y
            for t in range(length - 2, -1, -1):
                G[start + t] = (1 - args.lam) * V[start + t + 1] + args.lam * G[start + t + 1]

        net.train()
        perm = torch.randperm(n_samples, device=device)
        total = 0.0
        for _ in range(args.epochs_per_sweep):
            for i in range(0, n_samples, args.batch):
                sel = perm[i:i + args.batch]
                opt.zero_grad()
                pred = net(P[sel], F[sel])
                loss = bce(pred, G[sel])
                loss.backward()
                opt.step()
                total += loss.item() * len(sel)
        print(f"  sweep {sweep + 1}/{args.sweeps}: logloss(vs targets)={total / n_samples / args.epochs_per_sweep:.4f}")

    # reference outcome accuracy
    net.eval()
    with torch.no_grad():
        preds = torch.empty(n_samples, device=device)
        for i in range(0, n_samples, args.batch):
            preds[i:i + args.batch] = net(P[i:i + args.batch], F[i:i + args.batch])
    Y = torch.empty(n_samples, device=device)
    for start, length, y in spans:
        Y[start:start + length] = y
    acc = ((preds >= 0.5).float() == Y).float().mean().item()
    print(f"outcome-acc={acc * 100:.1f}%")

    # export weights for nn.mjs (plane-major conv weights: [outC][inC*9])
    def conv_export(conv):
        w = conv.weight.detach().cpu().numpy()  # [outC, inC, 3, 3]
        return {
            "w": [w[oc].reshape(-1).tolist() for oc in range(w.shape[0])],
            "b": conv.bias.detach().cpu().numpy().tolist(),
        }

    def fc_export(fc):
        return {
            "w": fc.weight.detach().cpu().numpy().tolist(),
            "b": fc.bias.detach().cpu().numpy().tolist(),
        }

    model = {
        "type": "conv",
        "tilePlanes": TILE_PLANES,
        "flatDim": flat_dim,
        "conv1": conv_export(net.conv1),
        "conv2": conv_export(net.conv2),
        "fc1": fc_export(net.fc1),
        "fc2": fc_export(net.fc2),
        "trainedWith": "td-conv",
        "lambda": args.lam,
        "acc": acc,
        "samples": n_samples,
    }
    with open(args.out, "w") as fh:
        json.dump(model, fh)
    print(f"model -> {args.out}")

    # parity vectors for the JS forward pass
    rng = random.Random(7)
    picks = [rng.randrange(n_samples) for _ in range(5)]
    with torch.no_grad():
        vectors = [
            {"f": all_f[i], "b": all_b[i], "v": float(net(P[i:i + 1], F[i:i + 1]).item())}
            for i in picks
        ]
    with open(args.out + ".parity.json", "w") as fh:
        json.dump(vectors, fh)
    print(f"parity -> {args.out}.parity.json  (verify: node sim/toolbench/nn.mjs parity {args.out} {args.out}.parity.json)")


if __name__ == "__main__":
    main()
