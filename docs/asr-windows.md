# ASR v2 на Windows и NVIDIA

Рабочее окружение изолировано в `.venv-asr` и не заменяет текущий `whisper.cpp`, пока новый конвейер не пройдёт приёмку.

## Зафиксированная конфигурация

- GPU: NVIDIA GeForce RTX 4080, 16 ГБ;
- драйвер: 610.88;
- Python: 3.10;
- WhisperX: 3.8.6;
- faster-whisper: 1.2.1;
- CTranslate2: 4.8.2;
- PyTorch: 2.8.0 + CUDA 12.8;
- torchaudio: 2.8.0 + CUDA 12.8;
- torchvision: 0.23.0 + CUDA 12.8.

Глобальный CUDA Toolkit не требуется: официальный PyTorch wheel содержит необходимые CUDA 12.8, cuBLAS и cuDNN 9 DLL. Адаптер `scripts/asr/transcribe.py` добавляет каталог этих DLL в область поиска процесса перед загрузкой WhisperX/CTranslate2.

## Воспроизведение окружения

```powershell
py -3.10 -m venv .venv-asr
.\.venv-asr\Scripts\python.exe -m pip install -r scripts\asr\requirements.txt
.\.venv-asr\Scripts\python.exe -m pip install --force-reinstall torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
```

## Ручной запуск адаптера

```powershell
.\.venv-asr\Scripts\python.exe scripts\asr\transcribe.py `
  storage\projects\PROJECT_ID\audio.wav `
  storage\projects\PROJECT_ID\transcript-v2.json `
  --device cuda `
  --compute-type float16 `
  --model large-v3-turbo `
  --language ru
```

Первый запуск скачивает ASR-модель и русскую модель выравнивания в `.cache-asr`. Эти файлы не входят в Git. До завершения сравнительного прогона worker продолжает использовать существующий `transcript.json`.

## Установленный результат

Диагностика окружения обнаружила `torch 2.8.0+cu128`, CUDA и GPU `NVIDIA GeForce RTX 4080` с compute capability 8.9. Модель и контрольные аудиофрагменты ещё не запускались по действующему ограничению на проверки без отдельного запроса владельца.
