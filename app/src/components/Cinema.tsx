import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { C, F, HOLO } from '../theme';
import { Sparkle } from './GameCard';
import { tap } from './ui';

const native = Platform.OS !== 'web';

// One of One gets a title card over the whole screen: it dims, "ABSOLUTELY" drops in, "BRILLION" lands in the
// holo foil, two glints flare on the landing, light crosses the letters, then the lettering lifts and the dark
// follows. About 1.3 s; a tap skips it.

// two glints, catching the corners of the lettering: the B's lower left and the N's upper right
const GLINTS = ['low-left', 'high-right'] as const;
/** BRILLION's drawn width, in font sizes, for the display face (measured from the web build) */
const WORD_EM = 4.0;

/** Plays once, `delay` ms after mount. Skipped under reduced motion. */
export function Cinema({ delay, reduce }: { delay: number; reduce: boolean }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [on, setOn] = useState(false);
  const dim = useRef(new Animated.Value(0)).current;
  const kicker = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const glint = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(1)).current; // the lettering lifts before the dark does
  const run = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => {
      setOn(true);
      const ease = Easing.out(Easing.cubic);
      run.current = Animated.sequence([
        Animated.parallel([
          Animated.timing(dim, { toValue: 1, duration: 150, useNativeDriver: native }),
          // the kicker drops onto the dark, the word lands just behind it
          Animated.sequence([Animated.delay(80), Animated.timing(kicker, { toValue: 1, duration: 200, easing: ease, useNativeDriver: native })]),
          Animated.sequence([Animated.delay(160), Animated.spring(word, { toValue: 1, friction: 8, tension: 150, useNativeDriver: native })]),
          Animated.sequence([Animated.delay(280), Animated.timing(glint, { toValue: 1, duration: 520, easing: Easing.linear, useNativeDriver: native })]),
          Animated.sequence([Animated.delay(560), Animated.timing(sweep, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: native })]),
        ]),
        Animated.delay(220),
        // the lettering goes first, then the dark lifts straight after: no empty dim beat, no double exposure
        Animated.timing(words, { toValue: 0, duration: 100, useNativeDriver: native }),
        Animated.timing(dim, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]);
      run.current.start(() => setOn(false));
      tap('medium');
    }, delay);
    return () => {
      clearTimeout(t);
      run.current?.stop();
    };
  }, [delay, reduce, dim, kicker, word, sweep, glint, words]);
  if (!on) return null;

  const skip = () => {
    run.current?.stop();
    setOn(false);
  };
  const boxW = Math.min(winW - 40, 360);
  const size = Math.min(60, boxW / 6);
  const wordW = boxW + 40;
  const wordH = Math.round(size * 1.2);
  const band = Math.round(size * 0.7);
  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-band, wordW] });
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={skip}>
      <Pressable accessibilityRole="button" accessibilityLabel="Absolutely Brillion. Tap to continue" onPress={skip} style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', opacity: dim }]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,12,0.93)' }]} />
          <Animated.View style={{ alignItems: "center", opacity: words }}>
          <Animated.Text
            style={{
              fontFamily: F.display,
              fontSize: Math.round(size * 0.3),
              letterSpacing: Math.round(size * 0.16),
              paddingLeft: Math.round(size * 0.16), // letter spacing trails the last letter; this keeps the word centred
              color: C.paper,
              marginBottom: 0,
              opacity: kicker,
              transform: [{ translateY: kicker.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
            }}
          >
            ABSOLUTELY
          </Animated.Text>
          <Animated.View
            style={{
              width: wordW,
              height: wordH,
              opacity: word.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }),
              transform: [{ scale: word.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1] }) }],
            }}
          >
            <Svg width={wordW} height={wordH}>
              <Defs>
                <LinearGradient id="brillion" x1="0" y1="0" x2="1" y2="0.35">
                  {HOLO.map((c, i) => (
                    <Stop key={c} offset={i / (HOLO.length - 1)} stopColor={c} />
                  ))}
                </LinearGradient>
              </Defs>
              <SvgText x={wordW / 2} y={size * 0.98} textAnchor="middle" fontFamily={F.display} fontSize={size} letterSpacing={size * 0.04} fill="url(#brillion)">
                BRILLION
              </SvgText>
            </Svg>
            {/* light crossing the letters only: a narrow window slides right over a white copy of the word that stays put */}
            <View style={{ position: 'absolute', left: 0, top: 0, width: wordW, height: wordH, overflow: 'hidden' }}>
              <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: band, height: wordH, overflow: 'hidden', transform: [{ translateX: sweepX }] }}>
                <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: wordW, height: wordH, transform: [{ translateX: Animated.multiply(sweepX, -1) }] }}>
                  <Svg width={wordW} height={wordH}>
                    <SvgText x={wordW / 2} y={size * 0.98} textAnchor="middle" fontFamily={F.display} fontSize={size} letterSpacing={size * 0.04} fill="#FFFFFF" fillOpacity={0.85}>
                      BRILLION
                    </SvgText>
                  </Svg>
                </Animated.View>
              </Animated.View>
            </View>
            {/* glints that flare around the word as it lands, gone before the hold */}
            {GLINTS.map((corner, i) => {
              const s = Math.round(size * 0.46);
              const half = (size * WORD_EM) / 2;
              const left = corner === 'low-left' ? wordW / 2 - half - s * 0.55 : wordW / 2 + half - s * 0.45;
              const top = corner === 'low-left' ? size * 0.98 - s * 0.45 : size * 0.26 - s * 0.55;
              const p = glint.interpolate({ inputRange: [0, 0.05, 0.3, 0.6, 1], outputRange: [0, 0, 1, 0, 0], extrapolate: 'clamp' });
              return (
                <Animated.View
                  key={corner}
                  style={{ position: 'absolute', left, top, opacity: p, transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }, { rotate: `${i * 15}deg` }] }}
                >
                  <Sparkle size={s} />
                </Animated.View>
              );
            })}
          </Animated.View>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
