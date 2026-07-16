export enum DateKind {
  Holiday = 1,
  Anniversary = 2,
  SolarTerms = 3,
  Sundry = 4,
}

export interface DateInfo {
  date: string; // "YYYY-MM-DD"
  name: string;
  holiday: boolean;
  remarks: string | null;
  kind: DateKind;
  time: string | null; // "HH:mm" (절기)
  sunLng: number | null; // 절기 태양황경
}
