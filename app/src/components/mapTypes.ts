import type { Fix } from '../net/LocationProvider';
import type { RoomView } from '../shared/types';

export type MapProps = { room: RoomView; meId: string; myFix: Fix | null; now: number; escape?: { lat: number; lng: number } | null; heading?: number | null };
