import { Vector3 } from 'three';
import { angleLerp, clamp } from '../../engine/math.js';
// Arena wraps skip most of the map between snapshots. Never blend across that distance.
const SNAP_DISTANCE = 32;
export interface RemoteSnapshotPose {
  p: Vector3;
  yaw: number;
  pitch: number;
  t: number;
}
/** Owns snapshot history and bounded pose interpolation; model/health/transport are separate. */
export class RemoteInterpolation {
  private before: RemoteSnapshotPose | null = null;
  private after: RemoteSnapshotPose | null = null;
  private readonly position = new Vector3();
  private readonly angles = { yaw: 0, pitch: 0 };
  constructor(
    private readonly body: { pos: Vector3; vel: Vector3 },
    private readonly velocity: Vector3,
  ) {}
  get previous() {
    return this.before;
  }
  get next() {
    return this.after;
  }
  push(snapshot: readonly number[], now: number): RemoteSnapshotPose {
    this.before = this.after || {
      p: new Vector3(snapshot[0], snapshot[1], snapshot[2]),
      yaw: snapshot[3],
      pitch: snapshot[4],
      t: now - 0.07,
    };
    this.after = {
      p: new Vector3(snapshot[0], snapshot[1], snapshot[2]),
      yaw: snapshot[3],
      pitch: snapshot[4],
      t: now,
    };
    if (
      Math.hypot(this.after.p.x - this.before.p.x, this.after.p.z - this.before.p.z) > SNAP_DISTANCE
    ) {
      this.before = null;
      this.body.pos.copy(this.after.p);
    }
    return this.after;
  }
  clearPrevious() {
    this.before = null;
  }
  update(dt: number, now: number): { yaw: number; pitch: number } | null {
    const next = this.after;
    if (!next) return null;
    const previous = this.before || next;
    const span = Math.max(0.02, next.t - previous.t);
    const time = now - 0.08;
    const fraction = clamp((time - previous.t) / span, 0, 1);
    this.position.lerpVectors(previous.p, next.p, fraction);
    const late = time - next.t;
    if (late > 0) this.position.addScaledVector(this.velocity, Math.min(late, 0.35));
    if (this.position.distanceToSquared(this.body.pos) > 36) this.body.pos.copy(this.position);
    else this.body.pos.lerp(this.position, 1 - Math.exp(-dt * 22));
    this.body.vel.copy(this.velocity);
    this.angles.yaw = angleLerp(previous.yaw, next.yaw, fraction);
    this.angles.pitch = previous.pitch + (next.pitch - previous.pitch) * fraction;
    return this.angles;
  }
}
