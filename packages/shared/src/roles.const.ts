export const USER_ROLES = ["VENDEDOR", "GERENTE", "DONO", "DESENVOLVEDOR"] as const;

export type UserRole = (typeof USER_ROLES)[number];
