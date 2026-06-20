import { currentWhere } from "./effective-dated.entity";
import { IsNull } from "typeorm";
test("currentWhere selects open rows", () => {
  expect(currentWhere()).toEqual({ effectiveTo: IsNull() });
});
