import React, { useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { C } from '../theme';
import { Label } from './ui';

/** Demo-mode joystick. Calls onMove(east, north) in m/s. */
export function Joystick({ onMove, size = 100, maxSpeed = 2.2 }: { onMove: (vx: number, vy: number) => void; size?: number; maxSpeed?: number }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const r = size / 2;
  const update = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    const x = dx * k;
    const y = dy * k;
    setKnob({ x, y });
    onMove((x / r) * maxSpeed, (-y / r) * maxSpeed);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_e, g) => update(g.dx, g.dy),
      onPanResponderMove: (_e, g) => update(g.dx, g.dy),
      onPanResponderRelease: () => update(0, 0),
      onPanResponderTerminate: () => update(0, 0),
    }),
  ).current;
  return (
    <View
      {...pan.panHandlers}
      accessibilityLabel="Demo joystick"
      style={{ width: size, height: size, borderRadius: r, backgroundColor: 'rgba(13,27,32,0.88)', borderWidth: 1, borderColor: C.ring, alignItems: 'center', justifyContent: 'center' }}
    >
      <Label style={{ position: 'absolute', top: 6, fontSize: 9 }}>Demo</Label>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.amber, opacity: 0.95, transform: [{ translateX: knob.x }, { translateY: knob.y }] }} />
    </View>
  );
}
