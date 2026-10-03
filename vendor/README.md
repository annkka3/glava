# Сторонние компоненты

Всё лежит в репозитории, чтобы приложение не зависело от внешних серверов.

| Что | Версия | Откуда | Лицензия |
|---|---|---|---|
| `ort/` — ONNX Runtime Web (сборка WebAssembly) | 1.30.0 | npm `onnxruntime-web`, https://github.com/microsoft/onnxruntime | MIT |
| `piper/` — фонемизатор Piper на espeak-ng | 1.0.0 | npm `@diffusionstudio/piper-wasm`, https://github.com/diffusion-studio/piper-wasm | MIT; внутри espeak-ng (GPL-3.0, https://github.com/espeak-ng/espeak-ng) и piper-phonemize (MIT, https://github.com/rhasspy/piper-phonemize) |
| `../voices/ru_RU-irina-medium` | medium | https://huggingface.co/rhasspy/piper-voices | модель: MIT; исходные записи RHVoice, лицензия набора данных не указана |
| `../voices/ru_RU-dmitri-medium` | medium | https://huggingface.co/rhasspy/piper-voices | модель: MIT; набор данных CC0 |
| `../voices/ru_RU-ruslan-medium` | medium | https://huggingface.co/rhasspy/piper-voices | модель: MIT; набор данных RUSLAN (https://ruslan-corpus.github.io/), CC BY-NC-SA 4.0: только некоммерческое использование |
| `../fonts/cormorant-*` | v24 | Google Fonts, https://github.com/CatharsisFonts/Cormorant | SIL OFL 1.1 |
| `../fonts/onest-*` | | Google Fonts, https://github.com/simpals/onest | SIL OFL 1.1 |

`piper/piper_phonemize.mjs` — это исходный `piper_phonemize.js` с добавленной в конец строкой `export default createPiperPhonemize;`, чтобы его можно было подключить как модуль.
