const MINOR =
  /\b(crian[cç]as?|criancinha|beb[eê]s?|toddler|infant|pre-?teens?|underage|loli|lolita|shota|child|children|kids?|menor(?:es)? de idade|menores)\b/i;

const SEXUAL =
  /\b(sex|sexual|sexo|nua|nuas|nudes?|pelad[oa]s?|porn[oô]?|nsfw|er[oó]tic[oa]?|buceta|p[eê]nis|penis|vagina|foder|fuck|gozar|orgasm|topless|mamilos?|sem roupa|pelada)\b/i;

/** Hard stop for sexual content involving minors. Adult fiction is not blocked here. */
export function blockedReason(prompt: string): string | null {
  const text = prompt.normalize("NFKC");
  if (/\b(loli|lolita|shota|child\s*porn|csam)\b/i.test(text)) {
    return "Não gero conteúdo sexual envolvendo menores.";
  }
  let underage = MINOR.test(text);
  for (const match of text.matchAll(/\b(\d{1,2})\s*anos\b/gi)) {
    const age = Number(match[1]);
    if (age > 0 && age < 18) underage = true;
  }
  if (underage && SEXUAL.test(text)) {
    return "Não gero conteúdo sexual envolvendo menores.";
  }
  return null;
}
