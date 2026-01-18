import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VoiceRecorderProps {
    onTranscription: (text: string) => void;
    currentValue?: string;  // Current input value to preserve
    disabled?: boolean;
}

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message?: string;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

interface SpeechRecognitionConstructor {
    new(): SpeechRecognition;
}

// Extend Window interface for webkit prefix
declare global {
    interface Window {
        SpeechRecognition: SpeechRecognitionConstructor;
        webkitSpeechRecognition: SpeechRecognitionConstructor;
    }
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    onTranscription,
    currentValue = '',
    disabled = false,
}) => {
    const [isListening, setIsListening] = useState(false);
    const [isSupported, setIsSupported] = useState(true);
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const onTranscriptionRef = useRef(onTranscription);
    const baseTextRef = useRef<string>('');  // Text before recording started

    // Keep the callback ref updated
    useEffect(() => {
        onTranscriptionRef.current = onTranscription;
    }, [onTranscription]);

    useEffect(() => {
        // Check for Web Speech API support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setIsSupported(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = '';
            let interimTranscript = '';

            // Rebuild full transcript from ALL results each time
            for (let i = 0; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Combine base text (pre-existing) + new transcript
            const speechText = (finalTranscript + interimTranscript).trim();
            const baseText = baseTextRef.current;
            const fullText = baseText
                ? (speechText ? `${baseText} ${speechText}` : baseText)
                : speechText;

            onTranscriptionRef.current(fullText);
        };

        recognition.onerror = (_event: SpeechRecognitionErrorEvent) => {
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;

        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.abort();
                } catch {
                    // Ignore abort errors on cleanup
                }
            }
        };
    }, []);

    const startListening = useCallback(() => {
        if (recognitionRef.current && !isListening) {
            // Save current input value as base text
            baseTextRef.current = currentValue.trim();
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (error) {
                // Error starting speech recognition - ignore if already started
            }
        }
    }, [isListening, currentValue]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current && isListening) {
            try {
                recognitionRef.current.stop();
            } catch {
                // Ignore stop errors
            }
        }
    }, [isListening]);

    const handleClick = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };

    if (!isSupported) {
        return (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className="h-8 w-8 p-0 opacity-50"
                title="Speech recognition not supported in this browser"
            >
                <Mic className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClick}
            disabled={disabled}
            className={`h-8 w-8 p-0 transition-colors ${
                isListening ? 'text-red-500 hover:bg-red-100' : 'hover:bg-gray-100'
            }`}
            title={isListening ? 'Click to stop' : 'Click to start voice input'}
        >
            {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
    );
};
