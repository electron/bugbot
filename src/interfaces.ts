// interfaces shared between client & server

export type FiddleBisectResult =
  | { success: false }
  | {
      success: true;
      goodVersion: string;
      badVersion: string;
    };
