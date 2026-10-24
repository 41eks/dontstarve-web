let count = 0;

/** mainfunctions.lua SetAutopaused: counted, so independent reasons cannot cancel each other. */
export function SetAutopaused(autopause: boolean): void {
  count += autopause ? 1 : -1;
  if (count < 0) {
    count = 0;
    throw new Error('Autopause count is invalid');
  }
}

export function IsAutopaused(): boolean {
  return count > 0;
}
