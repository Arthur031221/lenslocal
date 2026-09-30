// Supported source languages. Every photo is translated into English.
// Each model is a Xenova opus-mt-<code>-en checkpoint that runs in transformers.js.
export interface LanguageOption {
  code: string;
  name: string;
  model: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "ja", name: "Japanese", model: "Xenova/opus-mt-ja-en" },
  { code: "zh", name: "Chinese", model: "Xenova/opus-mt-zh-en" },
  { code: "fr", name: "French", model: "Xenova/opus-mt-fr-en" },
  { code: "es", name: "Spanish", model: "Xenova/opus-mt-es-en" },
  { code: "de", name: "German", model: "Xenova/opus-mt-de-en" },
  { code: "it", name: "Italian", model: "Xenova/opus-mt-it-en" },
  { code: "ko", name: "Korean", model: "Xenova/opus-mt-ko-en" },
  { code: "ru", name: "Russian", model: "Xenova/opus-mt-ru-en" },
];

export function findLanguage(code: string): LanguageOption {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang) throw new Error(`Unsupported source language: ${code}`);
  return lang;
}

export const OCR_MODEL_ID = "onnx-community/Florence-2-base-ft";
