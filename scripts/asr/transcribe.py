"""Create a versioned whole-word transcript artifact with WhisperX.

This adapter deliberately ignores Whisper tokenizer pieces. Caption text is built
only from sentence text and the whole-word entries returned by forced alignment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Any

CONTROL_TOKEN = re.compile(r"\[\s*_?TT_?\d+\s*\]|<\|[^|>]+\|>", re.IGNORECASE)
SPACE = re.compile(r"\s+")
DLL_DIRECTORY_HANDLES: list[Any] = []


def expose_torch_cuda_libraries() -> None:
    """Let CTranslate2 reuse the CUDA runtime bundled with the PyTorch wheel on Windows."""
    if os.name != "nt":
        return
    import torch

    library_directory = Path(torch.__file__).resolve().parent / "lib"
    if library_directory.is_dir():
        DLL_DIRECTORY_HANDLES.append(os.add_dll_directory(str(library_directory)))
        os.environ["PATH"] = f"{library_directory}{os.pathsep}{os.environ.get('PATH', '')}"


def clean_text(value: str) -> str:
    return SPACE.sub(" ", CONTROL_TOKEN.sub(" ", value)).strip()


def finite_number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_segments(raw_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    previous_end = 0.0
    for segment_index, raw in enumerate(raw_segments):
        text = clean_text(str(raw.get("text", "")))
        start = finite_number(raw.get("start"))
        end = finite_number(raw.get("end"))
        if not text or start is None or end is None or start < previous_end or end <= start:
            continue
        words: list[dict[str, Any]] = []
        alignment_complete = True
        word_previous_end = start
        for word_index, raw_word in enumerate(raw.get("words") or []):
            word_text = clean_text(str(raw_word.get("word", "")))
            word_start = finite_number(raw_word.get("start"))
            word_end = finite_number(raw_word.get("end"))
            if not word_text:
                continue
            if word_start is None or word_end is None:
                alignment_complete = False
                continue
            word_start = max(start, word_previous_end, word_start)
            word_end = min(end, max(word_start + 0.01, word_end))
            if word_end <= word_start:
                continue
            score = finite_number(raw_word.get("score"))
            words.append({
                "id": f"s{segment_index}w{word_index}",
                "text": word_text,
                "normalized": word_text.casefold(),
                "start": word_start,
                "end": word_end,
                "confidence": score,
                **({"speaker": str(raw_word["speaker"])} if raw_word.get("speaker") else {}),
            })
            word_previous_end = word_end
        if not alignment_complete:
            words = []
        normalized.append({
            "id": f"s{segment_index}",
            "text": text,
            "start": start,
            "end": end,
            "words": words,
            **({"speaker": str(raw["speaker"])} if raw.get("speaker") else {}),
        })
        previous_end = end
    if not normalized:
        raise RuntimeError("Распознавание не вернуло пригодных речевых сегментов.")
    return normalized


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--language", default="ru")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--model-cache", type=Path, default=Path(".cache-asr"))
    args = parser.parse_args()
    audio_path = args.audio.resolve(strict=True)
    model_cache = args.model_cache.resolve()
    model_cache.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(model_cache)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(model_cache / "hub")
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    started = time.perf_counter()

    expose_torch_cuda_libraries()
    import torch
    import whisperx

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "int8" if device == "cpu" and args.compute_type == "float16" else args.compute_type

    audio = whisperx.load_audio(str(audio_path))
    model = whisperx.load_model(
        args.model,
        device,
        compute_type=compute_type,
        language=args.language,
        download_root=str(model_cache),
    )
    result = model.transcribe(audio, batch_size=args.batch_size, language=args.language)
    align_model, metadata = whisperx.load_align_model(language_code=args.language, device=device, model_dir=str(model_cache))
    aligned = whisperx.align(result["segments"], align_model, metadata, audio, device, return_char_alignments=False)
    diarization_enabled = False
    diarization_token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if diarization_token:
        try:
            from whisperx.diarize import DiarizationPipeline, assign_word_speakers

            diarizer = DiarizationPipeline(token=diarization_token, device=device, cache_dir=str(model_cache / "hub"))
            diarization = diarizer(audio, min_speakers=1, max_speakers=8)
            aligned = assign_word_speakers(diarization, aligned, fill_nearest=True)
            diarization_enabled = True
        except Exception as error:
            print(f"Diarization unavailable, continuing without speaker labels: {error}", file=sys.stderr)
    artifact = {
        "schemaVersion": 2,
        "language": args.language,
        "model": args.model,
        "aligner": str(metadata.get("language", args.language)) if isinstance(metadata, dict) else args.language,
        "audioFingerprint": fingerprint(audio_path),
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "processingSeconds": round(time.perf_counter() - started, 3),
        "device": device,
        "computeType": compute_type,
        "diarizationEnabled": diarization_enabled,
        "segments": normalize_segments(aligned.get("segments") or []),
    }
    atomic_json(args.output.resolve(), artifact)


if __name__ == "__main__":
    main()
