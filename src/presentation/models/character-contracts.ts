/** Visual recipe inputs shared by enemies, remote players and map decorations. */
export interface CharacterAppearance {
  weapon: 'rifle' | 'blade' | 'shotgun' | 'sniper' | 'pistol' | 'boss' | 'bomb' | 'dive';
  scale: number;
  hat?: 'band' | 'helmet' | 'hood' | 'crown';
  shield?: boolean;
  bossKind?: 'doodler' | 'eraser' | 'inkblot';
  build?: { bodyW?: number; headS?: number; limbR?: number };
}
export type CharacterPart =
  | 'head'
  | 'torso'
  | 'hips'
  | 'armL'
  | 'armR'
  | 'foreL'
  | 'foreR'
  | 'legL'
  | 'legR'
  | 'shinL'
  | 'shinR'
  | 'shield';
export type CharacterHit = [CharacterPart, number];
