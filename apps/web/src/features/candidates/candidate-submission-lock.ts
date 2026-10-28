export function createSubmissionLock() {
  let locked = false;
  return {
    acquire(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    release(): void { locked = false; },
  };
}
