#!/usr/bin/env python3
"""Test HuggingFace access to pyannote models"""

import os
import torch

# Fix PyTorch 2.6 weights_only issue - pyannote is a trusted source
# Monkey-patch torch.load to use weights_only=False
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

from pyannote.audio import Pipeline

# Get token from environment
HF_TOKEN = os.getenv('HF_TOKEN')
if not HF_TOKEN:
    print("❌ Error: HF_TOKEN environment variable not set")
    print("Please set it with: export HF_TOKEN='your_token_here'")
    print("Or create a .env file with HF_TOKEN=your_token_here")
    exit(1)

print("Testing HuggingFace access...")
print(f"Token: {HF_TOKEN[:10]}...")

try:
    print("\nAttempting to load pipeline...")
    pipeline = Pipeline.from_pretrained(
        'pyannote/speaker-diarization-3.1',
        use_auth_token=HF_TOKEN
    )
    print("✅ Successfully loaded pipeline!")
    print(f"Pipeline type: {type(pipeline)}")
except Exception as e:
    print(f"❌ Failed to load pipeline: {e}")
    print("\nPlease verify:")
    print("1. Visit: https://huggingface.co/pyannote/speaker-diarization-3.1")
    print("2. Click 'Agree and access repository'")
    print("3. Wait 5-10 minutes for permissions to propagate")
