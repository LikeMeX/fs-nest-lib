import { Column } from "typeorm";
import { IsNull } from "typeorm";

export abstract class EffectiveDated {
  @Column({ name: "effective_from", type: "timestamptz", default: () => "now()" })
  effectiveFrom: Date;

  @Column({ name: "effective_to", type: "timestamptz", nullable: true })
  effectiveTo: Date | null;
}

export function currentWhere() {
  return { effectiveTo: IsNull() };
}
