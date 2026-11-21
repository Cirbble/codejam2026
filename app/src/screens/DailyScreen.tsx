import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { cap, MAX_TRIES } from '../api';
import { EmptySlot, GameCard } from '../components/GameCard';
import { Bar, H, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { C, F, TIERS } from '../theme';
import { useDaily } from './Home';

function untilText(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export default function DailyScreen() {
  const nav = useNav();
  const { daily, failed, reload } = useDaily();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Screen>
      <Bar onBack={nav.back} title="Today" right={<Mono style={{ width: 64, textAlign: 'right', color: C.ink, fontSize: 15 }}>{daily?.score ?? 0} pts</Mono>} />
      {!daily ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {failed ? (
            <T style={{ color: C.blaze, fontFamily: F.bodyBold }} onPress={reload}>
              Can't reach the server. Tap to retry.
            </T>
          ) : (
            <Mono>Loading</Mono>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {daily.prompts.map((p) => {
            const card = daily.cards[p.id];
            const used = daily.tries[p.id] ?? 0;
            const left = MAX_TRIES - used;
            const out = !card && left <= 0;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                disabled={out}
                onPress={() => {
                  tap();
                  if (card) nav.push({ name: 'card', card });
                  else nav.push({ name: 'shoot', promptId: p.id, promptText: p.text, examples: p.examples, mode: 'daily' });
                }}
                style={({ pressed }) => [styles.row, card && { backgroundColor: C.card }, pressed && { transform: [{ translateY: 2 }] }]}
              >
                {card ? <GameCard card={card} width={76} flat live={false} /> : <EmptySlot width={76} />}
                <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                  <H size={22}>{cap(p.text)}</H>
                  {card ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <T style={{ fontFamily: F.bodyBold, color: TIERS[card.tier].color }}>{TIERS[card.tier].name}</T>
                      <Mono>
                        {card.title} · {card.points} pts
                      </Mono>
                    </View>
                  ) : out ? (
                    <Mono style={{ color: C.faint }}>No tries left today</Mono>
                  ) : used > 0 ? (
                    <Mono style={{ color: C.blaze }}>{left} tries left</Mono>
                  ) : null}
                </View>
                {card && <Feather name="chevron-right" size={22} color={C.faint} />}
              </Pressable>
            );
          })}
          <Mono style={{ textAlign: 'center', marginTop: 8, color: C.faint }}>New hunt in {untilText(Math.max(0, daily.resetsAt - now))}</Mono>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    paddingRight: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: C.ink,
    backgroundColor: C.paper,
  },
});
