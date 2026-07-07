import importlib.util
if importlib.util.find_spec("torch") is None:
    print("NO-TORCH")
else:
    import torch
    print("torch", torch.__version__, "cuda:", torch.cuda.is_available(),
          torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")
