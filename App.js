import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Accelerometer } from 'expo-sensors';
import WORDS from './wordData';

// Shake detection thresholds (acceleration magnitude in g-force)
// Unstressed syllable: gentle shake between these bounds
const UNSTRESSED_MIN = 1.8;
const UNSTRESSED_MAX = 3.0;
// Stressed syllable: strong shake above this threshold
const STRESSED_MIN = 4.5;

// Time window for detecting each syllable shake (ms)
const SYLLABLE_WINDOW = 1500;
// Gap between syllable windows to let the user reset (ms)
const SYLLABLE_GAP = 300;

function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function App() {
  const [screen, setScreen] = useState('splash'); // 'splash' | 'game'
  const [words, setWords] = useState([]);
  const [wordIndex, setWordIndex] = useState(0);
  const [feedback, setFeedback] = useState(null); // null | 'correct' | 'incorrect'
  const [syllableIndex, setSyllableIndex] = useState(0); // which syllable we're listening for
  const [listening, setListening] = useState(false);
  const [peakAccel, setPeakAccel] = useState(0);
  const [stressHint, setStressHint] = useState('');

  const subscriptionRef = useRef(null);
  const peakRef = useRef(0);
  const timeoutRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);
  const syllableResultsRef = useRef([]);

  const currentWord = words[wordIndex] || null;

  const startGame = useCallback(() => {
    const shuffled = shuffleArray(WORDS);
    setWords(shuffled);
    setWordIndex(0);
    setFeedback(null);
    setSyllableIndex(0);
    setListening(false);
    setStressHint('');
    syllableResultsRef.current = [];
    setScreen('game');
  }, []);

  const advanceWord = useCallback(() => {
    setWordIndex((prev) => (prev + 1) % words.length);
    setFeedback(null);
    setSyllableIndex(0);
    setListening(false);
    setStressHint('');
    peakRef.current = 0;
    setPeakAccel(0);
    syllableResultsRef.current = [];
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
  }, [words.length]);

  const skipWord = useCallback(() => {
    advanceWord();
  }, [advanceWord]);

  // Start listening for a syllable shake
  const startListeningForSyllable = useCallback((sylIdx) => {
    setSyllableIndex(sylIdx);
    setListening(true);
    peakRef.current = 0;
    setPeakAccel(0);

    const isStressed = currentWord?.stress[sylIdx];
    setStressHint(isStressed ? 'SHAKE HARD!' : 'shake gently...');

    // End the listening window after SYLLABLE_WINDOW ms
    timeoutRef.current = setTimeout(() => {
      const peak = peakRef.current;
      const stressed = currentWord?.stress[sylIdx];
      let correct = false;

      if (stressed) {
        // Stressed: peak must exceed STRESSED_MIN
        correct = peak >= STRESSED_MIN;
      } else {
        // Unstressed: peak must be between UNSTRESSED_MIN and UNSTRESSED_MAX
        correct = peak >= UNSTRESSED_MIN && peak <= UNSTRESSED_MAX;
      }

      syllableResultsRef.current.push(correct);

      // If this was the last syllable, evaluate the full pattern
      if (sylIdx === 1) {
        const allCorrect = syllableResultsRef.current.every(Boolean);
        setFeedback(allCorrect ? 'correct' : 'incorrect');
        setListening(false);
        setStressHint('');
        syllableResultsRef.current = [];

        feedbackTimeoutRef.current = setTimeout(() => {
          if (allCorrect) {
            advanceWord();
          } else {
            setFeedback(null);
            setSyllableIndex(0);
            setStressHint('');
          }
        }, 2000);
      } else {
        // Move to next syllable after a brief gap
        setListening(false);
        setStressHint('get ready...');
        timeoutRef.current = setTimeout(() => {
          startListeningForSyllable(1);
        }, SYLLABLE_GAP);
      }
    }, SYLLABLE_WINDOW);
  }, [currentWord, advanceWord]);

  // Subscribe to accelerometer
  useEffect(() => {
    if (screen !== 'game' || feedback !== null) return;

    Accelerometer.setUpdateInterval(50);
    subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      // Calculate total acceleration magnitude
      // At rest this is ~1g (gravity). We want to detect shaking above rest.
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      if (listening && magnitude > peakRef.current) {
        peakRef.current = magnitude;
        setPeakAccel(magnitude);
      }

      // Auto-start first syllable detection on any shake
      if (!listening && syllableResultsRef.current.length === 0 && magnitude > UNSTRESSED_MIN) {
        startListeningForSyllable(0);
      }
    });

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [screen, feedback, listening, startListeningForSyllable]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  // Render stress pattern display
  const renderStressPattern = () => {
    if (!currentWord) return null;
    return (
      <View style={styles.stressPatternContainer}>
        {currentWord.stress.map((isStressed, i) => (
          <View key={i} style={styles.syllableIndicator}>
            <Text style={[
              styles.stressDot,
              isStressed ? styles.stressedDot : styles.unstressedDot,
              syllableIndex === i && listening ? styles.activeDot : null,
            ]}>
              {isStressed ? '●' : '○'}
            </Text>
            <Text style={styles.stressLabel}>
              {isStressed ? 'STRONG' : 'gentle'}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  if (screen === 'splash') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <Text style={styles.title}>ShayKit</Text>
        <Text style={styles.subtitle}>
          Practice word stress by shaking your phone
        </Text>
        <Text style={styles.instructions}>
          Shake HARD for stressed syllables{'\n'}
          Shake gently for unstressed syllables
        </Text>
        <TouchableOpacity style={styles.startButton} onPress={startGame}>
          <Text style={styles.startButtonText}>Start</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {feedback === 'correct' ? (
        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackCorrect}>✓</Text>
        </View>
      ) : feedback === 'incorrect' ? (
        <View style={styles.feedbackContainer}>
          <Text style={styles.feedbackIncorrect}>✗</Text>
        </View>
      ) : (
        <>
          <Text style={styles.wordCounter}>
            {wordIndex + 1} / {words.length}
          </Text>

          <Text style={styles.word}>{currentWord?.word}</Text>

          {renderStressPattern()}

          <Text style={styles.hintText}>
            {stressHint || 'Shake to begin!'}
          </Text>

          {listening && (
            <View style={styles.meterContainer}>
              <View style={[
                styles.meterBar,
                {
                  width: `${Math.min(100, (peakAccel / 8) * 100)}%`,
                  backgroundColor: peakAccel >= STRESSED_MIN
                    ? '#4CAF50'
                    : peakAccel >= UNSTRESSED_MIN
                      ? '#FFC107'
                      : '#666',
                },
              ]} />
            </View>
          )}

          <TouchableOpacity style={styles.skipButton} onPress={skipWord}>
            <Text style={styles.skipButtonText}>Skip →</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
    color: '#eee',
    textAlign: 'center',
    marginBottom: 24,
  },
  instructions: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 22,
  },
  startButton: {
    backgroundColor: '#e94560',
    paddingHorizontal: 64,
    paddingVertical: 16,
    borderRadius: 30,
  },
  startButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  wordCounter: {
    position: 'absolute',
    top: 60,
    right: 24,
    fontSize: 14,
    color: '#666',
  },
  word: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 32,
    textTransform: 'lowercase',
  },
  stressPatternContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    gap: 32,
  },
  syllableIndicator: {
    alignItems: 'center',
  },
  stressDot: {
    fontSize: 36,
    marginBottom: 4,
  },
  stressedDot: {
    color: '#e94560',
  },
  unstressedDot: {
    color: '#666',
  },
  activeDot: {
    color: '#FFC107',
  },
  stressLabel: {
    fontSize: 12,
    color: '#888',
  },
  hintText: {
    fontSize: 20,
    color: '#FFC107',
    marginBottom: 24,
    fontWeight: '600',
  },
  meterContainer: {
    width: '80%',
    height: 12,
    backgroundColor: '#333',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 48,
  },
  meterBar: {
    height: '100%',
    borderRadius: 6,
  },
  skipButton: {
    position: 'absolute',
    bottom: 60,
    right: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipButtonText: {
    fontSize: 16,
    color: '#666',
  },
  feedbackContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackCorrect: {
    fontSize: 120,
    color: '#4CAF50',
  },
  feedbackIncorrect: {
    fontSize: 120,
    color: '#f44336',
  },
});
