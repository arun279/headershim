export interface TabBadgeText {
  readonly tabId: number;
  readonly text: string;
}

interface BadgeColors {
  readonly backgroundColor: string;
  readonly textColor: string;
}

export type BadgeState =
  | (BadgeColors & { readonly kind: "count" })
  | (BadgeColors & {
      readonly kind: "manual";
      readonly global: boolean;
      readonly text: string;
    });
