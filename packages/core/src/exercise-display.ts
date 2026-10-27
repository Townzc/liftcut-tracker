import { exerciseLabel as catalogLabel } from "./exercise-catalog";

const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const genericLabels = [{ zh: "深蹲", en: "Squat" }, { zh: "划船", en: "Row" }, { zh: "弯举", en: "Curl" },
  { zh: "肩推", en: "Shoulder press" }, { zh: "侧平举", en: "Lateral raise" }, { zh: "飞鸟", en: "Fly" }];

/** Display only: generic movement translation never assigns equipment or a catalog ID. */
export function exerciseLabel(name: string, locale: string) {
  const identifiedLabel = catalogLabel(name, locale);
  if (identifiedLabel !== name) return identifiedLabel;
  const key = normalize(name), generic = genericLabels.find(x => normalize(x.zh) === key || normalize(x.en) === key);
  return generic ? (locale === "en" ? generic.en : generic.zh) : name;
}
