import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, DbzLegend, Dot, H, Label, Panel, T, fmtClock } from '../components/ui';
import { useGame } from '../net/GameProvider';
import { C, F, dbzColor } from '../theme';

export function Results() {
  const { room, session, send, leave } = useGame();
  const insets = useSafeAreaInsets();
  const [footerH, setFooterH] = useState(110);
  if (!room || !session || !room.results) return null;
  const r = room.results;
  const t = r.team;
  const host = room.hostId === session.playerId;
  const won = room.outcome === 'won';
  const standing = r.ranking.filter((p) => p.survived).length;
  const dist = t.distanceM >= 1000 ? `${(t.distanceM / 1000).toFixed(1)} KM` : `${t.distanceM} M`;
  const rows: Array<[string, string]> = [
    ['Duration', fmtClock(t.durationSec * 1000)],
    ['Peak level', `${t.peakLevel} / 5`],
    ['Dodges', String(t.dodges)],
    ['Hits taken', String(t.hits)],
    ['Revives', String(t.revives)],
    ...(t.distanceM >= 5 ? ([[t.simulated ? 'Demo walk' : 'On foot', dist]] as Array<[string, string]>) : []),
  ];
  const stamp = new Date(Date.now()).toTimeString().slice(0, 5);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 20, paddingBottom: footerH + 20 }]}>
        <View style={{ gap: 6 }}>
          <View style={styles.rowBetween}>
            <Label>{`Storm report · ${room.code} · ${stamp}`}</Label>
            {t.simulated && <T style={styles.tag}>DEMO</T>}
          </View>
          <H size={64} style={{ color: won ? C.safe : C.danger }}>
            {won ? 'Storm passed' : 'Storm won'}
          </H>
          <T style={styles.line}>{`${standing} OF ${r.ranking.length} STANDING`}</T>
          <View style={{ marginTop: 8 }}>
            <DbzLegend height={4} />
          </View>
        </View>

        <Panel style={{ paddingVertical: 6 }}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[styles.dataRow, i > 0 && styles.rule]}>
              <Label>{k}</Label>
              <T style={[styles.value, k === 'Peak level' && { color: dbzColor((t.peakLevel - 0.5) / 5) }]}>{v}</T>
            </View>
          ))}
        </Panel>

        <View style={{ gap: 8 }}>
          <Label>Crew</Label>
          <Panel style={{ paddingVertical: 4 }}>
            {r.ranking.map((p, i) => (
              <View key={p.id} style={[styles.crewRow, i > 0 && styles.rule]}>
                <T style={styles.rank}>{i + 1}</T>
                <Dot color={p.color} />
                <T style={styles.name} numberOfLines={1}>
                  {p.name}
                  {p.id === session.playerId ? '  (you)' : ''}
                </T>
                <Ionicons name={p.survived ? 'checkmark' : 'close'} size={18} color={p.survived ? C.safe : C.danger} accessibilityLabel={p.survived ? 'standing' : 'down'} />
                <T style={styles.score}>{p.score}</T>
              </View>
            ))}
          </Panel>
        </View>

        {r.awards.length > 0 && (
          <View style={{ gap: 10 }}>
            {r.awards.map((a) => (
              <View key={a.title} style={styles.award}>
                <Label style={{ color: C.amber, width: 110 }}>{a.title}</Label>
                <T style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 16 }} numberOfLines={1}>
                  {a.playerName}
                </T>
                <T style={{ fontFamily: F.mono, fontSize: 12, color: C.dim }}>{a.detail}</T>
              </View>
            ))}
          </View>
        )}

        <View style={{ gap: 4 }}>
          <Button
            title="Share report"
            icon="share-outline"
            kind="ghost"
            onPress={() => Share.share({ message: `Squall storm report: ${won ? 'storm passed' : 'storm won'}. ${fmtClock(t.durationSec * 1000)}, level ${t.peakLevel}, ${t.dodges} dodges, ${t.revives} revives, ${dist.toLowerCase()} on foot.${t.simulated ? ' (demo)' : ''}` })}
          />
          <Button title="Leave crew" kind="quiet" onPress={leave} />
        </View>
      </ScrollView>
      <View style={[styles.cta, { paddingBottom: insets.bottom + 12 }]} onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}>
        {host ? (
          <Button title="Run it again" icon="refresh" big onPress={() => send({ t: 'again' })} />
        ) : (
          <View style={{ alignItems: 'center', paddingVertical: 14 }}>
            <Label>Waiting for the host</Label>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 18, gap: 22, maxWidth: 560, width: '100%', alignSelf: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: { fontFamily: F.mono, fontSize: 10, color: C.amber, borderWidth: 1, borderColor: 'rgba(242,193,74,0.45)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, letterSpacing: 1 },
  line: { fontFamily: F.mono, fontSize: 13, color: C.dim, letterSpacing: 1.2 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11 },
  rule: { borderTopWidth: 1, borderTopColor: C.line },
  value: { fontFamily: F.monoBold, fontSize: 18, color: C.ink, fontVariant: ['tabular-nums'] },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  rank: { width: 18, fontFamily: F.mono, color: C.dim },
  name: { flex: 1, fontFamily: F.bodyBold, fontSize: 17 },
  score: { fontFamily: F.monoBold, fontSize: 17, minWidth: 44, textAlign: 'right' },
  award: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cta: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line },
});
