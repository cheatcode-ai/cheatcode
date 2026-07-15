"use client";

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComposerStatusTone } from "@/components/chat/use-prompt-attachments";

export interface VoiceInputState {
  isListening: boolean;
  isSupported: boolean;
  status: string | null;
  toggle: () => void;
  tone: ComposerStatusTone;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionAlternative {
  confidence: number;
  transcript: string;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  abort: () => void;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

export function useVoiceInput({
  currentValue,
  disabled,
  onChange,
}: {
  currentValue: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): VoiceInputState {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<ComposerStatusTone>("ok");
  const baseTextRef = useRef("");
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const recognition = useSpeechRecognition({
    baseTextRef,
    disabled,
    onChangeRef,
    setIsListening,
    setStatus,
    setTone,
  });
  const toggle = () =>
    toggleRecognition({
      baseTextRef,
      currentValue,
      disabled,
      onChangeRef,
      recognition,
      setIsListening,
      setStatus,
      setTone,
    });
  return { isListening, isSupported: recognition.isSupported, status, toggle, tone };
}

interface RecognitionLifecycle {
  baseTextRef: RefObject<string>;
  disabled: boolean;
  onChangeRef: RefObject<(value: string) => void>;
  setIsListening: (isListening: boolean) => void;
  setStatus: (status: string | null) => void;
  setTone: (tone: ComposerStatusTone) => void;
}

function useSpeechRecognition(lifecycle: RecognitionLifecycle) {
  const [isSupported, setIsSupported] = useState(true);
  const constructorRef = useRef<SpeechRecognitionConstructor | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { disabled, setIsListening, setStatus, setTone } = lifecycle;
  useEffect(() => {
    const Recognition = speechRecognitionConstructor();
    constructorRef.current = Recognition;
    if (!Recognition) {
      setIsSupported(false);
      setStatus("Voice input unavailable in this browser");
      setTone("error");
      return;
    }
    setIsSupported(true);
    return () => {
      constructorRef.current = null;
      invalidateActiveRecognition(recognitionRef, "abort");
    };
  }, [setStatus, setTone]);
  useLayoutEffect(() => {
    if (!disabled || !invalidateActiveRecognition(recognitionRef, "abort")) {
      return;
    }
    setIsListening(false);
    setTone("ok");
    setStatus("Voice input stopped");
  }, [disabled, setIsListening, setStatus, setTone]);
  return { constructorRef, isSupported, recognitionRef };
}

function invalidateActiveRecognition(
  recognitionRef: RefObject<SpeechRecognition | null>,
  mode: "abort" | "stop",
): boolean {
  const recognition = recognitionRef.current;
  if (!recognition) {
    return false;
  }
  recognitionRef.current = null;
  recognition.onend = null;
  recognition.onerror = null;
  recognition.onresult = null;
  try {
    recognition[mode]();
  } catch {
    // The browser may finish a session between the last event and this invalidation.
  }
  return true;
}

function configureRecognition(
  recognition: SpeechRecognition,
  lifecycle: RecognitionLifecycle & { recognitionRef: RefObject<SpeechRecognition | null> },
) {
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    if (lifecycle.recognitionRef.current !== recognition) {
      return;
    }
    const speechText = speechTranscript(event.results);
    const baseText = lifecycle.baseTextRef.current;
    lifecycle.onChangeRef.current(
      baseText && speechText ? `${baseText} ${speechText.trim()}` : speechText.trim(),
    );
  };
  recognition.onerror = (event) => {
    if (!releaseRecognition(recognition, lifecycle.recognitionRef)) {
      return;
    }
    lifecycle.setIsListening(false);
    lifecycle.setTone("error");
    lifecycle.setStatus(voiceErrorMessage(event.error));
  };
  recognition.onend = () => {
    if (!releaseRecognition(recognition, lifecycle.recognitionRef)) {
      return;
    }
    lifecycle.setIsListening(false);
    lifecycle.setTone("ok");
    lifecycle.setStatus("Voice input stopped");
  };
}

function releaseRecognition(
  recognition: SpeechRecognition,
  recognitionRef: RefObject<SpeechRecognition | null>,
): boolean {
  if (recognitionRef.current !== recognition) {
    return false;
  }
  recognitionRef.current = null;
  recognition.onend = null;
  recognition.onerror = null;
  recognition.onresult = null;
  return true;
}

function speechTranscript(results: SpeechRecognitionResultList): string {
  let speechText = "";
  for (let index = 0; index < results.length; index += 1) {
    speechText += results[index]?.[0]?.transcript ?? "";
  }
  return speechText;
}

type RecognitionToggleOptions = {
  baseTextRef: RefObject<string>;
  currentValue: string;
  disabled: boolean;
  onChangeRef: RefObject<(value: string) => void>;
  recognition: ReturnType<typeof useSpeechRecognition>;
  setIsListening: (isListening: boolean) => void;
  setStatus: (status: string | null) => void;
  setTone: (tone: ComposerStatusTone) => void;
};

function toggleRecognition(options: RecognitionToggleOptions) {
  if (options.disabled || !options.recognition.isSupported) {
    return;
  }
  if (invalidateActiveRecognition(options.recognition.recognitionRef, "stop")) {
    options.setIsListening(false);
    options.setTone("ok");
    options.setStatus("Voice input stopped");
    return;
  }
  const Recognition = options.recognition.constructorRef.current;
  if (!Recognition) {
    return;
  }
  const recognition = new Recognition();
  configureRecognition(recognition, {
    baseTextRef: options.baseTextRef,
    disabled: options.disabled,
    onChangeRef: options.onChangeRef,
    recognitionRef: options.recognition.recognitionRef,
    setIsListening: options.setIsListening,
    setStatus: options.setStatus,
    setTone: options.setTone,
  });
  try {
    options.baseTextRef.current = options.currentValue.trim();
    options.recognition.recognitionRef.current = recognition;
    recognition.start();
    options.setIsListening(true);
    options.setTone("ok");
    options.setStatus("Listening");
  } catch {
    invalidateActiveRecognition(options.recognition.recognitionRef, "abort");
    options.setTone("error");
    options.setStatus("Voice input could not start");
  }
}

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function voiceErrorMessage(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone permission denied";
  }
  if (error === "no-speech") {
    return "No speech detected";
  }
  return "Voice input failed";
}
