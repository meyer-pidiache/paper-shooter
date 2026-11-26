import { Vector3 } from 'three';
export interface SplashTarget {
  readonly isLocal: boolean;
  readonly alive: boolean;
  readonly center: Vector3;
  takeDamage(amount: number, point: Vector3): void;
}
export interface GrenadeBlastPorts {
  local: Pick<SplashTarget, 'alive' | 'center' | 'takeDamage'> & {
    knockback(direction: Vector3, amount: number): void;
  };
  targets(): Iterable<SplashTarget>;
  canHurt(target: SplashTarget): boolean;
  present(point: Vector3, radius: number): void;
  enemies(point: Vector3, radius: number, damage: number): void;
  props(point: Vector3, radius: number): void;
}
/** Owns local/thrower blast authority and ordered damage; visuals and target implementations are ports. */
export class GrenadeBlast {
  private readonly direction = new Vector3();
  constructor(private readonly ports: GrenadeBlastPorts) {}
  explode(point: Vector3, mine: boolean, harmsLocal = true) {
    const radius = 6.4;
    const { local } = this.ports;
    this.ports.present(point, radius);
    if (mine) this.ports.enemies(point, radius, 120);
    if (mine) this.ports.props(point, radius);
    const distance = local.center.distanceTo(point);
    if (harmsLocal && local.alive && distance < radius * 0.95) {
      local.takeDamage(10 + 34 * (1 - distance / (radius * 0.95)), point);
      local.knockback(this.direction.subVectors(local.center, point).normalize(), 9);
    }
    if (mine)
      for (const target of this.ports.targets()) {
        if (target.isLocal || !target.alive || !this.ports.canHurt(target)) continue;
        const remoteDistance = target.center.distanceTo(point);
        if (remoteDistance < radius * 0.95)
          target.takeDamage(12 + 50 * (1 - remoteDistance / (radius * 0.95)), point);
      }
  }
}
