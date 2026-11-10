// Phones only: tells the reader a wide table continues to the right -
// otherwise the last columns (values, actions) are simply never found
// (usability review 2026-11-09, from the E2E phone screenshots).
export function ScrollHint() {
  return <p className="mb-2 text-[11px] text-ink-faint sm:hidden">Deslize a tabela para o lado para ver todas as colunas →</p>;
}
