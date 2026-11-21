import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Card, fetchCollection } from '../api';
import { GameCard } from '../components/GameCard';
import { Bar, Button, H, Mono, Screen, T, tap } from '../components/ui';
import { useNav } from '../nav';
import { C, F, Tier, TIER_ORDER, TIERS } from '../theme';

export function Collection() {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Tier | null>(null);
  useEffect(() => {
    fetchCollection()
      .then(setCards)
      .catch(() => setFailed(true));
  }, []);
  const counts = useMemo(() => {
    const c: Record<Tier, number> = { one: 0, epic: 0, rare: 0, uncommon: 0, common: 0 };
    for (const k of cards ?? []) c[k.tier]++;
    return c;
  }, [cards]);
  const shown = (cards ?? []).filter((c) => !filter || c.tier === filter);
  const cw = (Math.min(width, 520) - 40 - 14) / 2;

  return (
    <Screen>
      <Bar onBack={nav.back} title="Collection" right={<Mono style={{ width: 44, textAlign: 'right', color: C.ink, fontSize: 15 }}>{cards?.length ?? ''}</Mono>} />
      {cards && cards.length > 0 && (
        <View style={styles.filters}>
          {TIER_ORDER.map((t) => {
            const on = filter === t;
            return (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  tap();
                  setFilter(on ? null : t);
                }}
                style={[styles.filter, { borderColor: TIERS[t].color }, on && { backgroundColor: TIERS[t].color }]}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: on ? C.white : TIERS[t].color }}>{counts[t]}</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: on ? C.white : C.ink }}>{TIERS[t].name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {!cards ? (
        <View style={styles.center}>
          {failed ? (
            <T style={{ color: C.blaze, fontFamily: F.bodyBold }}>Can't reach the server.</T>
          ) : (
            <Mono>Loading</Mono>
          )}
        </View>
      ) : cards.length === 0 ? (
        <View style={[styles.center, { gap: 16 }]}>
          <H size={30} style={{ textAlign: 'center' }}>
            No cards yet
          </H>
          <Button title="Start today's hunt" icon="camera" onPress={() => nav.reset({ name: 'daily' })} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => c.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 14 }}
          contentContainerStyle={{ gap: 18, paddingBottom: 24, paddingTop: 4 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <GameCard card={item} width={cw} live={false} onPress={() => nav.push({ name: 'card', card: item })} />}
        />
      )}
    </Screen>
  );
}

export function CardView({ card }: { card: Card }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const cw = Math.min(width - 56, 340);
  const t = TIERS[card.tier];
  const when = new Date(card.at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return (
    <Screen>
      <Bar onBack={nav.back} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <GameCard card={card} width={cw} />
        <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <H size={30} style={{ color: t.color }}>
              {t.name}
            </H>
            <H size={30}>+{card.points}</H>
          </View>
          <T style={{ fontFamily: F.bodyBold, fontSize: 17 }}>
            {card.sameCount <= 1 ? `Nobody else has found this · ${card.totalCount} ${card.totalCount === 1 ? 'find' : 'finds'} for this prompt` : `${card.sameCount} of ${card.totalCount} finds were the same`}
          </T>
          <Mono>
            {when} · {card.mode === 'daily' ? 'Daily' : 'Squad'}
          </Mono>
        </View>
      </View>
      <Button
        title="Share"
        icon="share"
        kind="line"
        onPress={() =>
          Share.share({
            message: `${card.title}: a ${t.name} find for "${card.promptText}" on Rarefind. ${card.sameCount} of ${card.totalCount} finds.`,
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
