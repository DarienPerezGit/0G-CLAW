# Handoff — `chore/demo-readiness`

> Para: Darien
> De: Juan
> Branch: `chore/demo-readiness` (basado en `main`)
> Estado: listo para revisar y mergear

---

## TL;DR

Trabajé sobre el track de **demo readiness** que habías agendado: README, documentación, validación de Docker, scripts de demo. **No toqué nada del core** (adapters, openclaw, agent.ts, scripts de testnet, vitest config, tsconfig) — todo lo que vos ya validaste sigue intacto.

Una sola excepción: encontré un **bug en `docker-compose.yml`** donde el volume mount estaba mal alineado con el path por defecto del `LocalMemoryAdapter`. Lo arreglé con una línea de env (`HOME=/app`), sin tocar código. Detalle más abajo.

---

## Qué hay en este branch

8 archivos cambiados, +851 / -137 líneas.

### Archivos nuevos

| Archivo | Contenido |
|---|---|
| `HANDOFF.md` | Este archivo |
| `examples/basic-agent/README.md` | Run modes, env-var matrix, errores comunes, dónde escribe la memoria |
| `docs/ARCHITECTURE.md` | Contratos de adapters, capacidades 0G-native, data flow por turno, deferred execution explicado, layout de Docker, boundaries |
| `docs/DEMO_SCRIPT.md` | Guion estructurado de 3 minutos: pre-flight, 5 actos con timing, narración, manejo de fallas de testnet |
| `docs/SUBMISSION.md` | Packet de submission para ETHGlobal — tracks, uso de protocolos, status, checklist, reviewer quickstart |

### Archivos modificados

| Archivo | Qué cambió |
|---|---|
| `README.md` | Reescritura completa — manteniendo el contenido bueno (arquitectura, status table, demo strategy) y agregando: status table al inicio, sección de Docker, broker funding requirements explícitos, deferred execution explicado, índice de docs |
| `docker-compose.yml` | **Bug fix** — agregué `environment: HOME=/app` (ver detalle abajo) |
| `.dockerignore` | Endurecido — excluye `data/`, `.0g-claw/`, `.pnpm-store`, `.vscode`, `coverage`, Docker meta. Mantiene `.env.example` explícitamente con `!.env.example` |
| `.gitignore` | Agregué `data/` y `.0g-claw/` para que el estado local del agente no entre al repo |

---

## El bug que encontré (Docker volume mount)

### Síntoma

`docker compose up` corría el agente OK, sesiones se persistían según los logs… **pero `./data/` quedaba vacío**. La promesa de "memoria sobrevive a `docker compose down`" no se cumplía.

### Causa raíz

`LocalMemoryAdapter` (línea 37) usa por defecto `path.join(os.homedir(), '.0g-claw')`. Adentro del container Node corre como root, así que `os.homedir()` devuelve `/root` → escribe en `/root/.0g-claw`.

Pero el `docker-compose.yml` montaba el volumen a `/app/.0g-claw`. Caminos distintos → datos huérfanos en el container, volumen vacío en el host.

### Fix

**Sin tocar código.** Agregué `HOME=/app` al `environment:` del compose. Eso hace que `os.homedir()` resuelva a `/app`, el adapter escribe en `/app/.0g-claw`, que es exactamente donde está montado el volumen.

```yaml
environment:
  # LocalMemoryAdapter writes to `${HOME}/.0g-claw`. Pinning HOME to /app
  # makes that resolve to /app/.0g-claw, which is the volume mount below.
  - HOME=/app
volumes:
  - ./data:/app/.0g-claw
```

### Verificación

Después del fix, `docker compose up -d && ls data/`:

```
data/claw-agent-0/sessions/session-adbcf383.json
data/claw-agent-0/sessions/session-df4accf9.json
data/claw-agent-0/history/session-adbcf383.jsonl
data/claw-agent-0/history/session-df4accf9.jsonl
...
```

Sesiones e historial sobreviven al `docker compose down`. La promesa del compose ahora coincide con el comportamiento.

> **Nota:** los archivos en `data/` quedan owned by root (porque el container corre como root). Para limpiar entre demos: `sudo rm -rf data/`. Lo documenté en el README.

---

## Lo que NO toqué (forbidden files)

Confirmé con `git diff --stat` que estos archivos no aparecen en el commit:

- `adapters/` (memory + compute, las dos interfaces y las 4 implementaciones)
- `openclaw/` (submodule)
- `examples/basic-agent/agent.ts`
- `scripts/check-testnet.ts`
- `scripts/setup-compute-broker.ts` y demás
- `vitest.config.ts`
- `tsconfig.json`
- `package.json` / `pnpm-lock.yaml`

Lo único que leí de `adapters/` fue para entender cómo `LocalMemoryAdapter` resuelve el storage path (necesario para diagnosticar el bug del volume). Solo lectura.

---

## Validación

| Check | Resultado |
|---|---|
| `tsc` (= `pnpm build`) | ✅ exit 0, `dist/` se genera con todos los `.js` y `.d.ts` |
| `docker compose build` | ✅ exit 0 (después de un `docker builder prune` por un cache corrupto del daemon, no relacionado con nuestro código) |
| `docker compose up -d` | ✅ container levanta, agente corre, sesiones aparecen en `./data/` |
| `docker compose down -v` | ✅ container y network se limpian, `./data/` se mantiene en el host |

No corrí `pnpm test` porque eso toca tu suite contra testnet y no quería gastar testnet tokens / interferir con tu setup. Cuando lo corras vos, deberían seguir verde — no toqué nada que afecte tests.

---

## Decisiones de contenido que vale la pena revisar

### README

- Puse el status table **al principio**, antes del problem statement. Es lo primero que mira un judge.
- Mantuve toda la "Demo Strategy" original que vos habías escrito en el README (la lógica de "primary path: storage memory + local compute, optional live compute si testnet sano"). La copié al `DEMO_SCRIPT.md` con más detalle.
- Cambié el link de "qwen3-plus / GLM-5-FP8" por los providers reales del `.env.example` (`qwen-2.5-7b-instruct`, `gpt-oss-20b`, `gemma-3-27b-it`). El README viejo tenía un mismatch.

### DEMO_SCRIPT

- El guion está pensado para que la **demo tolere caída del testnet de Galileo**. La cuenta importante es:
  - Acto 2 (memoria portable): solo necesita 0G Storage live, que es estable.
  - Acto 3 (verifiable inference): la versión segura es **mostrar el output de los 21/21 tests**, no hacer una llamada live. La live es opcional, solo si `pnpm check:testnet` está verde.
  - Acto 4 (fallback): siempre se puede correr, no necesita nada.
- Si te parece muy paranoico, lo bajamos. Pero la realidad es que en una demo en vivo, una upload lenta de Galileo te mata el momentum.

### SUBMISSION

- Marqué los dos tracks: framework ($7,500) como primario, ENS ($2,500) como bonus pendiente.
- En el "team" puse mi mail y tu GitHub. Cambialo si querés.
- El "reviewer quickstart" asume que un judge tiene 5 minutos — los pasos están ordenados de "no necesita creds" a "necesita creds 0G".

### ARCHITECTURE

- Documenté el patrón de **deferred execution** del `0GComputeAdapter` (construcción cheap, primer `chat()` resuelve metadata, errores explícitos en uso, no en boot). Es lo que hace que el agente boot-ee en CI/Docker sin creds 0G.
- Mapeé las 4 capacidades 0G-native a líneas de código concretas (verifiable inference → `verificationHash`, shared memory → keys con `agentId:sessionId`, replayable → `loadHistory` + Log Store, portable identity → wallet).

---

## Pendientes que no estaban en mi scope

| Item | Quién lo agarra |
|---|---|
| ENS identity at agent creation | Track ENS — vos o yo, definamos |
| Multi-device validation real (mismo wallet, dos máquinas) | Cualquiera de los dos — es el "test final" antes de submission |
| Demo video bajo 3 min | Yo, basado en `docs/DEMO_SCRIPT.md` |
| Live demo link | Decidir si hosteamos el agente en algún lado |

Ninguno requiere tocar el core.

---

## Cómo revisar este branch

```bash
git fetch origin
git checkout chore/demo-readiness

# Diff completo
git diff main...chore/demo-readiness

# O por archivo
git show HEAD --stat
git show HEAD -- docker-compose.yml   # el cambio más sensible

# Smoke test del Docker fix
cp .env.example .env   # con valores vacíos, fallback a local está OK
docker compose up -d
sleep 5
ls data/claw-agent-0/sessions/    # debería tener archivos
docker compose down
```

---

## Si querés cambiar algo

Decime qué y lo arreglo en este mismo branch. Los archivos largos (`SUBMISSION.md`, `DEMO_SCRIPT.md`) son los más opinionados — si no te cierran, los reescribo.

Si todo OK, mergealo cuando quieras a `main`. La única restricción de orden que vos mencionaste (`feat/0g-memory-adapter` antes de `feat/basic-agent-wiring`) ya está cumplida — los dos están en `main`.
