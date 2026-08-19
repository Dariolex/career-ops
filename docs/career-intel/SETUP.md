# Setup

## Prerequisiti

- Node.js ≥ 18
- Un fork **privato** di `career-ops`
- Una chiave API Anthropic

## Passi

1. **Clonare il fork**

   ```bash
   gh repo clone Dariolex/career-ops
   cd career-ops
   npm install
   ```

2. **Compilare il profilo**

   Modificare `config/profile.yml` e `modes/_profile.md` sostituendo ogni voce
   `DA COMPLETARE` con i dati reali.

3. **Inserire il CV**

   Sostituire il contenuto di `cv.md` con il CV reale, in Markdown. Finché resta il
   segnaposto, la dimensione professional fit — il 25% del punteggio — non è
   attendibile.

4. **Configurare le chiavi**

   ```bash
   cp .env.example .env
   # inserire ANTHROPIC_API_KEY
   ```

5. **Verificare**

   ```bash
   node validate-portals.mjs
   node career-score.test.mjs
   node scan.mjs
   ```

6. **Configurare i secrets su GitHub** — vedi [SECRETS.md](SECRETS.md).

## Personalizzare la ricerca

`portals.yml` contiene i filtri. `title_filter.positive` è la leva più importante: un
titolo che non corrisponde letteralmente a una voce dell'elenco viene scartato in
silenzio. Aggiungere le varianti di dicitura che interessano, incluse quelle in
italiano e tedesco.
