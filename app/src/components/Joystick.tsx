import React, { useRef, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { PanResponder, View } from 'react-native';
import { C } from '../theme';


/** Demo-mode joystick. Calls onMove(east, north) in m/s. */
export function Joystick({ onMove, size = 112, maxSpeed = 2.2 }: { onMove: (vx: number, vy: number) => void; size?: number; maxSpeed?: number }) {
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
      style={{ width: size, height: size, borderRadius: r, backgroundColor: 'rgba(238,242,245,0.95)', borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', boxShadow: `0px 3px 0px ${C.line}` }}
    >
      {/* thumbstick: four direction marks and a ridged knob */}
      <Feather name="chevron-up" size={16} color={C.inkSoft} style={{ position: 'absolute', top: 4 }} />
      <Feather name="chevron-down" size={16} color={C.inkSoft} style={{ position: 'absolute', bottom: 4 }} />
      <Feather name="chevron-left" size={16} color={C.inkSoft} style={{ position: 'absolute', left: 4 }} />
      <Feather name="chevron-right" size={16} color={C.inkSoft} style={{ position: 'absolute', right: 4 }} />
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: knob.x }, { translateY: knob.y }], boxShadow: '0px 3px 0px #6F7F8B' }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' }} />
      </View>
    </View>
  );
}
