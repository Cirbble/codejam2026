import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Dot, Isobars, Panel, T, fmtClock } from '../components/ui';
import { useGame } from '../net/GameProvider';
import { C, F, R, dbzColor } from '../theme';

export function Results() {
  const { room, session, send, leave } = useGame();
  const insets = useSafeAreaInsets();
  const [footerH, setFooterH] = useState(160);
  if (!room || !session || !room.results) return null;
  const r = room.results;
  const t = r.team;
  const host = room.hostId === session.playerId;
  const won = room.outcome === 'won';
  const isBot = (id: string) => !!room.players.find((p) => p.id === id)?.bot;
  const people = r.ranking.filter((p) => !isBot(p.id));
  const standing = people.filter((p) => p.survived).length;
  const stats: Array<[string, string]> = [
    [String(t.dodges), t.dodges === 1 ? 'dodge' : 'dodges'],
    [String(t.revives), t.revives === 1 ? 'revive' : 'revives'],
    [String(t.peakLevel), 'top level'],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.sky }}>
      <Isobars />
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 18, paddingBottom: footerH + 16 }]}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Feather name={won ? 'sun' : 'cloud-lightning'} size={30} color={C.ink} />
          </View>
          <Text style={styles.head}>{won ? 'You outlasted the storm' : 'The storm won'}</Text>
          <Text style={styles.line}>
            {won ? `${standing} of ${people.length} still standing` : people.length > 1 ? 'Everyone went down' : 'You went down'} · {fmtClock(t.durationSec * 1000)}{t.simulated ? ' · demo' : ''}
          </Text>
          <View style={styles.stats}>
            {stats.map(([v, l], i) => (
              <View key={l} style={[styles.stat, i > 0 && { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.16)' }]}>
                <Text style={[styles.statV, l === 'top level' && { color: dbzColor((t.peakLevel - 0.5) / 5) }]}>{v}</Text>
                <Text style={styles.statL}>{l}</Text>
              </View>
            ))}
          </View>
        </View>

        <Panel style={{ paddingVertical: 4 }}>
          {r.ranking.map((p, i) => (
            <View key={p.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: C.skyDeep }]}>
              <Text style={[styles.rank, i === 0 && { color: C.ink }]}>{i + 1}</Text>
              <Dot color={p.color} size={14} />
              <T style={styles.name} numberOfLines={1}>
                {p.name}
                {p.id === session.playerId ? <T style={{ color: C.faint }}> (you)</T> : null}
              </T>
              <Feather name={p.survived ? 'check' : 'x'} size={18} color={p.survived ? C.ink : C.faint} accessibilityLabel={p.survived ? 'standing' : 'down'} />
              <Text style={styles.score}>{p.score}</Text>
            </View>
          ))}
        </Panel>
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}>
        {host ? <Button title="Run it again" icon="rotate-cw" onPress={() => send({ t: 'again' })} /> : <T style={{ textAlign: 'center', color: C.inkSoft, paddingVertical: 18, fontFamily: F.bodyMid }}>Waiting for the host</T>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button
            title="Share"
            icon="share-2"
            kind="outline"
            style={{ flex: 1 }}
            onPress={() => Share.share({ message: `Squall: ${won ? 'we outlasted the storm' : 'the storm won'}. ${t.dodges} dodges, ${t.revives} revives, level ${t.peakLevel}.${t.simulated ? ' (demo)' : ''}` })}
          />
          <Button title="Leave" kind="outline" style={{ flex: 1 }} onPress={leave} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { backgroundColor: C.ink, borderRadius: 32, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 8, gap: 10, boxShadow: '0px 5px 0px #6F7F8B' },
  badge: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  head: { fontFamily: F.displayHeavy, fontSize: 38, lineHeight: 44, letterSpacing: -1.2, color: C.white, marginTop: 6 },
  line: { fontFamily: F.bodyMid, fontSize: 17, color: '#AAB6C0' },
  stats: { flexDirection: 'row', marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)' },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 16, gap: 2 },
  statV: { fontFamily: F.displayHeavy, fontSize: 34, lineHeight: 40, color: C.white },
  statL: { fontFamily: F.bodyMid, fontSize: 14, color: '#AAB6C0' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rank: { width: 22, fontFamily: F.display, fontSize: 18, color: C.faint },
  name: { flex: 1, fontFamily: F.bodyBold, fontSize: 18 },
  score: { fontFamily: F.display, fontSize: 18, color: C.ink, minWidth: 44, textAlign: 'right' },
  cta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, gap: 12, backgroundColor: C.sky, borderTopWidth: 1, borderTopColor: C.skyDeep },
});
