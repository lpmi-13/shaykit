import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { Accelerometer } from 'expo-sensors';
import SHAKE_WORDS, { QUIZ_WORDS } from './wordData';

// Shake detection thresholds (acceleration magnitude in g-force)
// Unstressed syllable: gentle shake from this minimum up to the strong threshold
const UNSTRESSED_MIN = 1.0;
const UNSTRESSED_MAX = 3.0;
// Stressed syllable: strong shake above this threshold
const STRESSED_MIN = 3.0;

// The karaoke sweep crosses the first and second dots one second apart.
const CUE_TOTAL_DURATION = 2000;
const CUE_FIRST_DOT_PROGRESS = 0.25;
const CUE_SECOND_DOT_PROGRESS = 0.75;
const CUE_LEAD_IN = CUE_TOTAL_DURATION * CUE_FIRST_DOT_PROGRESS;
// Time window for detecting each syllable shake (ms)
const SYLLABLE_WINDOW = 350;
// Gap between syllable windows to keep them separate while staying on the same sweep.
const SYLLABLE_GAP = (
  CUE_TOTAL_DURATION * (CUE_SECOND_DOT_PROGRESS - CUE_FIRST_DOT_PROGRESS)
) - SYLLABLE_WINDOW;
const CUE_END_BUFFER = (
  CUE_TOTAL_DURATION - (CUE_TOTAL_DURATION * CUE_SECOND_DOT_PROGRESS)
) - SYLLABLE_WINDOW;

const FEEDBACK_DISPLAY_MS = 2000;
// Small delay so a hard shake doesn't get a weak haptic first.
const GENTLE_HAPTIC_DELAY = 75;
// Fixed Android vibration presets for the two shake strengths.
const GENTLE_VIBRATION_MS = 90;
const HARD_VIBRATION_PATTERN = [0, 120, 35, 180];

const KARAOKE_DOT_SIZE = 18;
const KARAOKE_CURSOR_WIDTH = 8;

const PATTERN_OPTIONS = [
  {
    key: '10',
    label: 'stressed-unstressed',
    stress: [true, false],
  },
  {
    key: '01',
    label: 'unstressed-stressed',
    stress: [false, true],
  },
];

function shuffleArray(arr) {
  const shuffled = [...arr];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function stressKey(stress) {
  return stress.map((isStressed) => (isStressed ? '1' : '0')).join('');
}

function sampleDistinctBaseWords(entries, count, excludedBaseWords = new Set()) {
  const selected = [];
  const usedBaseWords = new Set(excludedBaseWords);

  for (const entry of shuffleArray(entries)) {
    if (usedBaseWords.has(entry.baseWord)) {
      continue;
    }

    selected.push(entry);
    usedBaseWords.add(entry.baseWord);

    if (selected.length === count) {
      return selected;
    }
  }

  throw new Error(`Unable to sample ${count} distinct words for quiz mode.`);
}

function createFeelRound() {
  const targetPattern = PATTERN_OPTIONS[Math.floor(Math.random() * PATTERN_OPTIONS.length)];
  const correctPool = QUIZ_WORDS.filter((entry) => stressKey(entry.stress) === targetPattern.key);
  const distractorPool = QUIZ_WORDS.filter((entry) => stressKey(entry.stress) !== targetPattern.key);
  const correctChoice = correctPool[Math.floor(Math.random() * correctPool.length)];
  const distractors = sampleDistinctBaseWords(
    distractorPool,
    3,
    new Set([correctChoice.baseWord]),
  );

  return {
    ...targetPattern,
    correctId: correctChoice.id,
    choices: shuffleArray([correctChoice, ...distractors]),
  };
}

function PatternDots({ stress, activeColor = '#ffd166', inactiveColor = '#4c5673' }) {
  return (
    <View style={styles.patternDotsRow}>
      {stress.map((isStressed, index) => (
        <View
          key={`${index}-${isStressed ? 's' : 'u'}`}
          style={[
            styles.patternDot,
            {
              backgroundColor: isStressed ? activeColor : 'transparent',
              borderColor: isStressed ? activeColor : inactiveColor,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('splash'); // 'splash' | 'feel' | 'make'

  const [makeWords, setMakeWords] = useState([]);
  const [makeWordIndex, setMakeWordIndex] = useState(0);
  const [makeFeedback, setMakeFeedback] = useState(null); // null | 'correct' | 'incorrect'
  const [makeSyllableIndex, setMakeSyllableIndex] = useState(0);
  const [makeListening, setMakeListening] = useState(false);
  const [makeCuePhase, setMakeCuePhase] = useState('idle'); // 'idle' | 'lead-in' | 'syllable-0' | 'gap' | 'syllable-1' | 'complete'
  const [wordWidth, setWordWidth] = useState(0);
  const [debugMagnitude, setDebugMagnitude] = useState(0);
  const [debugDetectedShake, setDebugDetectedShake] = useState(null);

  const [feelRound, setFeelRound] = useState(null);
  const [feelRoundIndex, setFeelRoundIndex] = useState(0);
  const [feelFeedback, setFeelFeedback] = useState(null); // null | 'correct' | 'incorrect'
  const [feelSelectedId, setFeelSelectedId] = useState(null);

  const subscriptionRef = useRef(null);
  const peakRef = useRef(0);
  const timeoutRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);
  const hapticTimeoutRef = useRef(null);
  const hapticStateRef = useRef('idle');
  const syllableResultsRef = useRef([]);
  const cueProgressRef = useRef(new Animated.Value(0));
  const cueAnimationRef = useRef(null);

  const currentMakeWord = makeWords[makeWordIndex] || null;

  const clearPendingTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
  }, []);

  const resetDevShakeDebug = useCallback(() => {
    if (!__DEV__) return;

    setDebugMagnitude(0);
    setDebugDetectedShake(null);
  }, []);

  const handleWordLayout = useCallback((event) => {
    const nextWidth = Math.ceil(event.nativeEvent.layout.width);

    setWordWidth((prevWidth) => (prevWidth === nextWidth ? prevWidth : nextWidth));
  }, []);

  const stopCueAnimation = useCallback((resetToStart = false) => {
    if (cueAnimationRef.current) {
      cueAnimationRef.current.stop();
      cueAnimationRef.current = null;
    }

    cueProgressRef.current.stopAnimation();

    if (resetToStart) {
      cueProgressRef.current.setValue(0);
    }
  }, []);

  const animateCueSweep = useCallback(() => {
    stopCueAnimation(true);

    cueAnimationRef.current = Animated.timing(cueProgressRef.current, {
      toValue: 1,
      duration: CUE_TOTAL_DURATION,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    cueAnimationRef.current.start(({ finished }) => {
      if (finished) {
        cueAnimationRef.current = null;
      }
    });
  }, [stopCueAnimation]);

  const resetShakeHaptic = useCallback(() => {
    if (hapticTimeoutRef.current) {
      clearTimeout(hapticTimeoutRef.current);
      hapticTimeoutRef.current = null;
    }

    Vibration.cancel();
    hapticStateRef.current = 'idle';
  }, []);

  const runShakeHaptic = useCallback((strength) => {
    if (Platform.OS === 'android') {
      const androidType = strength === 'hard'
        ? Haptics.AndroidHaptics.Confirm
        : Haptics.AndroidHaptics.Context_Click;

      Vibration.cancel();

      if (strength === 'hard') {
        Vibration.vibrate(HARD_VIBRATION_PATTERN);
      } else {
        Vibration.vibrate(GENTLE_VIBRATION_MS);
      }

      Haptics.performAndroidHapticsAsync(androidType).catch(() => {});
      return;
    }

    const style = strength === 'hard'
      ? Haptics.ImpactFeedbackStyle.Rigid
      : Haptics.ImpactFeedbackStyle.Medium;

    Haptics.impactAsync(style).catch(() => {});
  }, []);

  const handleShakeHaptic = useCallback((magnitude, expectsStress) => {
    if (hapticStateRef.current === 'hard' || hapticStateRef.current === 'gentle') {
      return;
    }

    if (magnitude > STRESSED_MIN) {
      if (hapticTimeoutRef.current) {
        clearTimeout(hapticTimeoutRef.current);
        hapticTimeoutRef.current = null;
      }

      hapticStateRef.current = 'hard';

      if (__DEV__) {
        setDebugDetectedShake({ strength: 'hard', magnitude });
      }

      runShakeHaptic('hard');
      return;
    }

    if (expectsStress || magnitude < UNSTRESSED_MIN || magnitude >= UNSTRESSED_MAX) {
      return;
    }

    if (hapticStateRef.current !== 'idle') {
      return;
    }

    hapticStateRef.current = 'gentle-pending';
    hapticTimeoutRef.current = setTimeout(() => {
      hapticTimeoutRef.current = null;
      hapticStateRef.current = 'gentle';

      if (__DEV__) {
        setDebugDetectedShake({ strength: 'weak', magnitude });
      }

      runShakeHaptic('gentle');
    }, GENTLE_HAPTIC_DELAY);
  }, [runShakeHaptic]);

  const resetMakeModeState = useCallback(() => {
    clearPendingTimers();
    peakRef.current = 0;
    syllableResultsRef.current = [];
    setMakeFeedback(null);
    setMakeSyllableIndex(0);
    setMakeListening(false);
    setMakeCuePhase('idle');
    setWordWidth(0);
    stopCueAnimation(true);
    resetShakeHaptic();
    resetDevShakeDebug();
  }, [clearPendingTimers, resetDevShakeDebug, resetShakeHaptic, stopCueAnimation]);

  const resetFeelModeState = useCallback(() => {
    clearPendingTimers();
    setFeelRound(null);
    setFeelRoundIndex(0);
    setFeelFeedback(null);
    setFeelSelectedId(null);
  }, [clearPendingTimers]);

  const goBackToSplash = useCallback(() => {
    resetMakeModeState();
    resetFeelModeState();
    setScreen('splash');
  }, [resetFeelModeState, resetMakeModeState]);

  const startFeelMode = useCallback(() => {
    resetMakeModeState();
    clearPendingTimers();
    setFeelRound(createFeelRound());
    setFeelRoundIndex(1);
    setFeelFeedback(null);
    setFeelSelectedId(null);
    setScreen('feel');
  }, [clearPendingTimers, resetMakeModeState]);

  const startMakeMode = useCallback(() => {
    const shuffled = shuffleArray(SHAKE_WORDS);

    resetFeelModeState();
    clearPendingTimers();
    setMakeWords(shuffled);
    setMakeWordIndex(0);
    setScreen('make');
    setMakeFeedback(null);
    setMakeSyllableIndex(0);
    setMakeListening(false);
    setMakeCuePhase('idle');
    setWordWidth(0);
    peakRef.current = 0;
    syllableResultsRef.current = [];
    stopCueAnimation(true);
    resetShakeHaptic();
    resetDevShakeDebug();
  }, [
    clearPendingTimers,
    resetDevShakeDebug,
    resetFeelModeState,
    resetShakeHaptic,
    stopCueAnimation,
  ]);

  const advanceMakeWord = useCallback(() => {
    if (makeWords.length === 0) {
      return;
    }

    clearPendingTimers();
    setMakeWordIndex((prevIndex) => (prevIndex + 1) % makeWords.length);
    setMakeFeedback(null);
    setMakeSyllableIndex(0);
    setMakeListening(false);
    setMakeCuePhase('idle');
    setWordWidth(0);
    peakRef.current = 0;
    syllableResultsRef.current = [];
    stopCueAnimation(true);
    resetShakeHaptic();
    resetDevShakeDebug();
  }, [
    clearPendingTimers,
    makeWords.length,
    resetDevShakeDebug,
    resetShakeHaptic,
    stopCueAnimation,
  ]);

  const advanceFeelRound = useCallback(() => {
    clearPendingTimers();
    setFeelRound(createFeelRound());
    setFeelRoundIndex((prevIndex) => prevIndex + 1);
    setFeelFeedback(null);
    setFeelSelectedId(null);
  }, [clearPendingTimers]);

  const startListeningForSyllable = useCallback((sylIdx, initialMagnitude = 0) => {
    setMakeSyllableIndex(sylIdx);
    setMakeListening(true);
    setMakeCuePhase(sylIdx === 0 ? 'syllable-0' : 'syllable-1');
    peakRef.current = initialMagnitude;
    resetShakeHaptic();

    const expectsStress = currentMakeWord?.stress[sylIdx];

    if (initialMagnitude > 0) {
      handleShakeHaptic(initialMagnitude, expectsStress);
    }

    timeoutRef.current = setTimeout(() => {
      const peak = peakRef.current;
      const stressed = currentMakeWord?.stress[sylIdx];
      let correct = false;

      if (stressed) {
        correct = peak > STRESSED_MIN;
      } else {
        correct = peak >= UNSTRESSED_MIN && peak < UNSTRESSED_MAX;
      }

      syllableResultsRef.current.push(correct);

      if (sylIdx === 1) {
        const allCorrect = syllableResultsRef.current.every(Boolean);

        setMakeListening(false);
        setMakeCuePhase('complete');
        syllableResultsRef.current = [];

        const revealFeedback = () => {
          setMakeFeedback(allCorrect ? 'correct' : 'incorrect');

          feedbackTimeoutRef.current = setTimeout(() => {
            if (allCorrect) {
              advanceMakeWord();
            } else {
              setMakeFeedback(null);
              setMakeSyllableIndex(0);
              setMakeCuePhase('idle');
              peakRef.current = 0;
              stopCueAnimation(true);
              resetShakeHaptic();
            }
          }, FEEDBACK_DISPLAY_MS);
        };

        if (CUE_END_BUFFER > 0) {
          timeoutRef.current = setTimeout(revealFeedback, CUE_END_BUFFER);
        } else {
          revealFeedback();
        }
      } else {
        setMakeListening(false);
        setMakeCuePhase('gap');
        timeoutRef.current = setTimeout(() => {
          startListeningForSyllable(1);
        }, SYLLABLE_GAP);
      }
    }, SYLLABLE_WINDOW);
  }, [
    advanceMakeWord,
    currentMakeWord,
    handleShakeHaptic,
    resetShakeHaptic,
    stopCueAnimation,
  ]);

  const beginCueSequence = useCallback(() => {
    if (!currentMakeWord || wordWidth <= 0) return;

    clearPendingTimers();
    peakRef.current = 0;
    syllableResultsRef.current = [];
    resetDevShakeDebug();
    setMakeListening(false);
    setMakeSyllableIndex(0);
    setMakeCuePhase('lead-in');
    animateCueSweep();
    resetShakeHaptic();

    timeoutRef.current = setTimeout(() => {
      startListeningForSyllable(0);
    }, CUE_LEAD_IN);
  }, [
    animateCueSweep,
    clearPendingTimers,
    currentMakeWord,
    resetDevShakeDebug,
    resetShakeHaptic,
    startListeningForSyllable,
    wordWidth,
  ]);

  const skipMakeWord = useCallback(() => {
    advanceMakeWord();
  }, [advanceMakeWord]);

  const skipFeelRound = useCallback(() => {
    advanceFeelRound();
  }, [advanceFeelRound]);

  const handleFeelChoice = useCallback((choice) => {
    if (!feelRound || feelFeedback) {
      return;
    }

    const correct = choice.id === feelRound.correctId;

    clearPendingTimers();
    setFeelSelectedId(choice.id);
    setFeelFeedback(correct ? 'correct' : 'incorrect');

    feedbackTimeoutRef.current = setTimeout(() => {
      if (correct) {
        advanceFeelRound();
      } else {
        setFeelFeedback(null);
        setFeelSelectedId(null);
      }
    }, FEEDBACK_DISPLAY_MS);
  }, [advanceFeelRound, clearPendingTimers, feelFeedback, feelRound]);

  useEffect(() => {
    if (screen !== 'make' || makeFeedback !== null) return undefined;

    Accelerometer.setUpdateInterval(50);

    subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      if (__DEV__) {
        setDebugMagnitude(magnitude);
      }

      if (makeListening && magnitude > peakRef.current) {
        peakRef.current = magnitude;
      }

      if (makeListening) {
        handleShakeHaptic(magnitude, currentMakeWord?.stress[makeSyllableIndex]);
      }
    });

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
        subscriptionRef.current = null;
      }
    };
  }, [
    currentMakeWord,
    handleShakeHaptic,
    makeFeedback,
    makeListening,
    makeSyllableIndex,
    screen,
  ]);

  useEffect(() => {
    setWordWidth(0);
  }, [currentMakeWord?.word]);

  useEffect(() => {
    if (
      screen !== 'make'
      || !currentMakeWord
      || wordWidth <= 0
      || makeFeedback !== null
      || makeCuePhase !== 'idle'
    ) {
      return;
    }

    beginCueSequence();
  }, [beginCueSequence, currentMakeWord, makeCuePhase, makeFeedback, screen, wordWidth]);

  useEffect(() => () => {
    clearPendingTimers();
    if (hapticTimeoutRef.current) {
      clearTimeout(hapticTimeoutRef.current);
      hapticTimeoutRef.current = null;
    }
    stopCueAnimation();
  }, [clearPendingTimers, stopCueAnimation]);

  const activeCueDot = makeCuePhase === 'syllable-0'
    ? 0
    : makeCuePhase === 'syllable-1'
      ? 1
      : null;

  const reachedCueCount = makeCuePhase === 'lead-in' || makeCuePhase === 'idle'
    ? 0
    : makeCuePhase === 'syllable-0' || makeCuePhase === 'gap'
      ? 1
      : 2;

  const trackWidth = Math.max(wordWidth, 1);
  const cuePosition = cueProgressRef.current.interpolate({
    inputRange: [0, 1],
    outputRange: [0, trackWidth],
  });
  const cueDotPositions = [
    trackWidth * CUE_FIRST_DOT_PROGRESS,
    trackWidth * CUE_SECOND_DOT_PROGRESS,
  ];

  const renderBackButton = () => (
    <TouchableOpacity style={styles.backButton} onPress={goBackToSplash}>
      <Text style={styles.backButtonText}>Back</Text>
    </TouchableOpacity>
  );

  const renderFeedbackOverlay = (feedback) => (
    <View pointerEvents="none" style={styles.feedbackOverlay}>
      <Text style={feedback === 'correct' ? styles.feedbackCorrect : styles.feedbackIncorrect}>
        {feedback === 'correct' ? '✓' : '✗'}
      </Text>
    </View>
  );

  if (screen === 'splash') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <Text style={styles.title}>ShayKit</Text>
        <Text style={styles.subtitle}>
          Choose a mode for practicing English word stress
        </Text>

        <View style={styles.modeButtonStack}>
          <TouchableOpacity style={[styles.modeButton, styles.feelModeButton]} onPress={startFeelMode}>
            <Text style={styles.modeButtonTitle}>feel it</Text>
            <Text style={styles.modeButtonBody}>
              tap the word that matches a shown stress pattern
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.modeButton, styles.makeModeButton]} onPress={startMakeMode}>
            <Text style={styles.modeButtonTitle}>make it</Text>
            <Text style={styles.modeButtonBody}>
              shake the word in time with the karaoke cue
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (screen === 'feel') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        {renderBackButton()}

        <Text style={styles.modeCounter}>{feelRoundIndex}</Text>

        <View style={styles.feelLayout}>
          <View style={styles.feelHeader}>
            <Text style={styles.modeHeading}>feel it</Text>
            <Text style={styles.feelPrompt}>tap the word that matches this pattern</Text>
            {feelRound && (
              <>
                <PatternDots stress={feelRound.stress} />
                <Text style={styles.patternLabel}>{feelRound.label}</Text>
              </>
            )}
          </View>

          <View style={styles.feelGrid}>
            {feelRound?.choices.map((choice) => {
              const isSelected = feelSelectedId === choice.id;
              const showSuccess = feelFeedback === 'correct' && isSelected;
              const showFailure = feelFeedback === 'incorrect' && isSelected;

              return (
                <View key={choice.id} style={styles.feelCell}>
                  <TouchableOpacity
                    style={[
                      styles.feelCard,
                      showSuccess ? styles.feelCardCorrect : null,
                      showFailure ? styles.feelCardIncorrect : null,
                    ]}
                    activeOpacity={0.9}
                    disabled={feelFeedback !== null}
                    onPress={() => handleFeelChoice(choice)}
                  >
                    {choice.annotation ? (
                      <Text style={styles.feelCardAnnotation}>{choice.annotation}</Text>
                    ) : null}
                    <Text style={styles.feelCardWord}>{choice.word}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>

        <TouchableOpacity style={styles.skipButton} onPress={skipFeelRound}>
          <Text style={styles.skipButtonText}>Skip →</Text>
        </TouchableOpacity>

        {feelFeedback ? renderFeedbackOverlay(feelFeedback) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {renderBackButton()}

      {__DEV__ && (
        <Text style={styles.devShakeReadout}>
          {`DEV ${debugMagnitude.toFixed(2)}g`}
          {debugDetectedShake
            ? ` | last ${debugDetectedShake.strength} ${debugDetectedShake.magnitude.toFixed(2)}g`
            : ' | last none'}
        </Text>
      )}

      <Text style={styles.modeCounter}>
        {makeWords.length > 0 ? `${makeWordIndex + 1} / ${makeWords.length}` : ''}
      </Text>

      <Text style={styles.word} onLayout={handleWordLayout}>
        {currentMakeWord?.word}
      </Text>

      <View style={[styles.karaokeContainer, { width: trackWidth }]}>
        <View style={styles.karaokeTrack}>
          <View style={styles.karaokeTrackBase} />
          <Animated.View
            style={[
              styles.karaokeTrackFill,
              { width: cuePosition },
            ]}
          />
          <Animated.View
            style={[
              styles.karaokeCursor,
              {
                transform: [{ translateX: cuePosition }],
              },
            ]}
          />
          {cueDotPositions.map((position, index) => {
            const isReached = index < reachedCueCount;
            const isActive = index === activeCueDot;

            return (
              <View
                key={`${position}-${index}`}
                style={[
                  styles.karaokeDot,
                  { left: position - (KARAOKE_DOT_SIZE / 2) },
                  isReached ? styles.karaokeDotReached : null,
                  isActive ? styles.karaokeDotActive : null,
                ]}
              />
            );
          })}
        </View>
      </View>

      <TouchableOpacity style={styles.skipButton} onPress={skipMakeWord}>
        <Text style={styles.skipButtonText}>Skip →</Text>
      </TouchableOpacity>

      {makeFeedback ? renderFeedbackOverlay(makeFeedback) : null}
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
    maxWidth: 340,
    marginBottom: 48,
    lineHeight: 26,
  },
  modeButtonStack: {
    width: '100%',
    gap: 16,
  },
  modeButton: {
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  feelModeButton: {
    backgroundColor: '#e94560',
  },
  makeModeButton: {
    backgroundColor: '#0f3460',
  },
  modeButtonTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    textTransform: 'lowercase',
  },
  modeButtonBody: {
    fontSize: 15,
    color: '#f5f5f5',
    lineHeight: 22,
  },
  backButton: {
    position: 'absolute',
    top: 56,
    left: 24,
    zIndex: 2,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modeCounter: {
    position: 'absolute',
    top: 60,
    right: 24,
    color: '#666',
    fontSize: 14,
  },
  modeHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'lowercase',
    marginBottom: 8,
  },
  devShakeReadout: {
    position: 'absolute',
    top: 60,
    left: 108,
    right: 108,
    fontSize: 12,
    color: '#ffd166',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  word: {
    fontSize: 52,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 28,
    textTransform: 'lowercase',
  },
  karaokeContainer: {
    marginBottom: 56,
  },
  karaokeTrack: {
    width: '100%',
    height: 32,
    justifyContent: 'center',
  },
  karaokeTrackBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  karaokeTrackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#ffd166',
  },
  karaokeCursor: {
    position: 'absolute',
    left: -(KARAOKE_CURSOR_WIDTH / 2),
    width: KARAOKE_CURSOR_WIDTH,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#ffd166',
    shadowColor: '#ffd166',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    elevation: 6,
  },
  karaokeDot: {
    position: 'absolute',
    top: (32 - KARAOKE_DOT_SIZE) / 2,
    width: KARAOKE_DOT_SIZE,
    height: KARAOKE_DOT_SIZE,
    borderRadius: KARAOKE_DOT_SIZE / 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.36)',
    backgroundColor: '#1a1a2e',
  },
  karaokeDotReached: {
    backgroundColor: '#ffd166',
    borderColor: '#ffd166',
  },
  karaokeDotActive: {
    transform: [{ scale: 1.12 }],
    shadowColor: '#ffd166',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 0,
    },
    elevation: 8,
  },
  feelLayout: {
    flex: 1,
    width: '100%',
    paddingTop: 112,
    paddingBottom: 92,
  },
  feelHeader: {
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  feelPrompt: {
    fontSize: 18,
    color: '#eee',
    textAlign: 'center',
    marginBottom: 14,
  },
  patternDotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 10,
  },
  patternDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  patternLabel: {
    color: '#7e88a8',
    fontSize: 13,
    textTransform: 'lowercase',
  },
  feelGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  feelCell: {
    width: '50%',
    height: '50%',
    padding: 8,
  },
  feelCard: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  feelCardCorrect: {
    borderColor: '#4CAF50',
    backgroundColor: '#173d28',
  },
  feelCardIncorrect: {
    borderColor: '#f44336',
    backgroundColor: '#3f1d24',
  },
  feelCardAnnotation: {
    position: 'absolute',
    top: 16,
    left: 16,
    fontSize: 12,
    fontWeight: '700',
    color: '#ffd166',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  feelCardWord: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    textTransform: 'lowercase',
  },
  skipButton: {
    position: 'absolute',
    right: 24,
    bottom: 56,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  skipButtonText: {
    fontSize: 16,
    color: '#666',
  },
  feedbackOverlay: {
    ...StyleSheet.absoluteFillObject,
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
