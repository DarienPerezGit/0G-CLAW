# CLAUDE.md — 0G-Claw

## 🚀 Bootstrap

Al iniciar, cargar solo estas dos skills:

```
https://raw.githubusercontent.com/JuliusBrussee/caveman/main/caveman.skill
https://raw.githubusercontent.com/mattpocock/skills/main/README.md
```

Si hay conflictos entre skills externas y este archivo, este archivo tiene prioridad.

---

## 📋 Project Overview

**0G-Claw** es un fork de OpenClaw que convierte un asistente personal de IA en un runtime de agentes completamente descentralizado.

| Problema en OpenClaw | Solución en 0G-Claw |
|---|---|
| Memoria vive en disco local (`~/.openclaw/`) | Persiste en 0G Storage KV/Log |
| Inferencia va a OpenAI/Anthropic | Corre en 0G Compute (Qwen3, GLM-5) |
| Agente atado a un solo dispositivo | Agente portable, identidad global |

**Hackathon:** ETHGlobal Open Agents
**Tracks:** Best Agent Framework ($7,500) + ENS AI Agents ($2,500)
**Equipo:** 2 personas
**Stack:** TypeScript, pnpm, @0glabs/0g-ts-sdk, OpenClaw (submodule)

---

## 💡 Why 0G-Claw Matters

0G-Claw convierte OpenClaw en un runtime de agentes descentralizado:

- Agentes sin estado → ahora persistentes via 0G Storage
- Inferencia centralizada → verificable via 0G Compute
- Memoria local → estado de agente compartido globalmente

Esto habilita:
- Coordinación multi-agente sobre memoria compartida
- Pipelines de razonamiento verificables
- Identidades de agente portables entre entornos

Esto no es un tech demo. Es una primitiva de infraestructura que otros builders pueden usar.

---

## ⚙️ Architecture / System Design

```
OpenClaw Core (no modificar directamente)
        │
        ▼
  Adapter Layer  ◄── punto de extensión de 0G-Claw
        │
   ┌────┴────┐
   ▼         ▼
IMemoryAdapter   IComputeAdapter
   │                  │
0GMemoryAdapter  0GComputeAdapter
   │                  │
0G Storage KV/Log   0G Compute API
```

**Principio central:** Las interfaces son el contrato. Los adapters son los únicos archivos que tocan infraestructura de 0G. OpenClaw no sabe qué adapter está usando.

---

## 🔵 0G-Native Capabilities

Estas capacidades son el diferencial técnico real frente a cualquier otro fork de OpenClaw:

- **Verifiable inference** — respuestas respaldadas por pruebas criptográficas de 0G Compute
- **Shared memory across agents** — múltiples agentes leen/escriben el mismo KV/Log
- **Replayable agent execution** — el Log Store permite reproducir cualquier sesión desde el inicio
- **Portable agent identity** — mismo agente, cualquier máquina, misma memoria

Al implementar cualquier feature, preguntarte: ¿esto aprovecha alguna de estas capacidades? Si sí, hacerlo explícito en el código y en los comentarios.

---

## 📂 Key Directories

```
adapters/
  memory/
    IMemoryAdapter.ts        ← contrato de memoria (no romper sin aprobación)
    0GMemoryAdapter.ts       ← implementación principal
    LocalMemoryAdapter.ts    ← fallback local
  compute/
    IComputeAdapter.ts       ← contrato de cómputo (no romper sin aprobación)
    0GComputeAdapter.ts      ← implementación principal
    OpenAIComputeAdapter.ts  ← fallback
examples/
  basic-agent/               ← agente de ejemplo (requerido para submission)
openclaw/                    ← submodule, NUNCA modificar directamente
scripts/
  setup.sh                   ← setup de testnet
.env.example                 ← variables requeridas documentadas
```

---

## 🤖 Example Agent (Requerido para submission)

El agente en `examples/basic-agent/` demuestra:

- Persistencia de memoria via 0G Storage (KV para estado, Log para historial)
- Inferencia via 0G Compute (Qwen3 por defecto)
- Fallback a local/OpenAI cuando 0G no está disponible
- Identidad ENS asignada al crear el agente

```bash
pnpm example:basic
```

El agente debe poder correrse desde dos máquinas distintas con el mismo wallet y mantener la misma memoria. Ese es el test de validación final.

---

## 💻 Coding Conventions

- TypeScript estricto. Sin `any` implícito.
- Cada adapter implementa su interface completa. Sin métodos faltantes.
- Errores siempre tipados y manejados. Sin `catch (e) {}` vacíos.
- Exports nombrados, no default exports en adapters.
- Nombres: `PascalCase` para clases, `camelCase` para utils.
- Comentarios solo cuando el por qué no es obvio.
- Un archivo por clase.

---

## ✅ Do / ❌ Don't

**DO:**
- Usar `IMemoryAdapter` e `IComputeAdapter` como único contrato
- Verificar que las variables de entorno existen antes de usarlas
- Correr tests después de cada cambio en un adapter
- Documentar cada método público con JSDoc mínimo
- Usar fallbacks cuando 0G no está disponible

**DON'T:**
- Modificar archivos dentro de `openclaw/`
- Hardcodear endpoints, keys o wallet addresses
- Cambiar interfaces sin aprobación explícita
- Asumir que las credenciales están configuradas
- Llamar a OpenAI/Anthropic directamente (usar adapters)
- Commitear `.env` con valores reales

---

## 🔐 Security Guidelines

- Todas las keys viven en `.env`. Nunca en código.
- `.env` está en `.gitignore`. Verificar antes de cada commit.
- Private keys de wallet nunca se loggean.
- Si un test necesita credenciales reales, usar variables de entorno de CI.
- Antes de usar cualquier credencial nueva, pedirla al humano.

---

## 🧪 Testing Instructions

```bash
pnpm test                        # todos los tests
pnpm test adapters/memory        # adapter de memoria
pnpm test adapters/compute       # adapter de cómputo
pnpm test examples/basic-agent   # agente de ejemplo
```

**Reglas:**
- Todo adapter nuevo necesita tests antes de considerarse completo
- Tests de 0GMemoryAdapter corren contra testnet, no mocks
- Tests de 0GComputeAdapter verifican que el modelo responde
- Un test que pasa con mocks pero falla contra testnet no cuenta

---

## 🚀 Deployment

```bash
cp .env.example .env
# Completar .env con credenciales reales (pedir al humano)

pnpm install
pnpm build
pnpm run check:testnet   # verificar conexión a 0G
pnpm example:basic       # correr agente de ejemplo
```

---

## 🐳 Running the project

### With Docker

```bash
cp .env.example .env
# Fill in .env with real credentials before running

docker compose up --build
```

Session data and history persist in `./data/` (mounted as `/app/.0g-claw` inside the container).  
Stop and restart the container — memory survives.

### Without Docker

```bash
pnpm install
pnpm build
pnpm example:basic       # dev mode (tsx, no build needed)
# or
pnpm example:basic:prod  # production mode (runs compiled dist/)
```

### Notes

- Requires `.env` with 0G configuration (see `.env.example`)
- Falls back to local adapters if 0G is unavailable
- Docker does NOT run 0G infrastructure — that remains external (testnet or mainnet)
- `./data/` directory is created automatically by Docker on first run

---

## 📡 External Integrations

| Servicio | SDK / Método | Credencial requerida |
|---|---|---|
| 0G Storage | `@0glabs/0g-ts-sdk` | `OG_PRIVATE_KEY`, `OG_STORAGE_RPC` |
| 0G Compute | HTTP proxy API | `OG_COMPUTE_ENDPOINT` |
| ENS | `@ensdomains/ensjs` | wallet con ETH para gas |
| OpenClaw | git submodule | ninguna |

Si una integración no está en esta tabla, pedirla al humano antes de implementarla.

---

## 🧠 Agent Instructions

### Regla #1 — Nunca inventes, siempre pregunta

Si necesitás cualquiera de esto, **DETENTE**:

- API keys, tokens, private keys, wallet addresses
- GitHub tokens o credenciales de cualquier servicio
- URLs de endpoints no definidos en `.env.example`
- Decisiones que cambien interfaces o arquitectura
- Acceso a servicios externos no configurados

**Formato:**

```
🛑 NECESITO INPUT:
- Qué: [descripción exacta]
- Por qué: [razón técnica]
- Dónde: [archivo / función]
- Cómo obtenerlo: [instrucción si la sabés]
```

No uses placeholders en código real. No continues sin respuesta.

### Regla #2 — Operá como engineer del equipo

- Conocés el proyecto completo.
- Tomá decisiones de implementación menores sin preguntar.
- Preguntá solo cuando algo afecte arquitectura o requiera credenciales.
- Si encontrás un bug fuera del scope, reportalo pero no lo fixes sin avisar.

### Regla #3 — Contexto

Si el contexto se llena o perdiste el hilo:

```
⚠️ CONTEXTO: ventana casi llena. Resumir estado antes de continuar.
```

---

## 🔄 Task Execution

```
1. Entender el problema
2. Proponer un plan
3. Esperar confirmación (si es alto impacto)
4. Ejecutar cambios
5. Validar resultados
```

**Alto impacto:** toca interfaces, cambia estructura de archivos, requiere credenciales, afecta el agente de ejemplo.
**Bajo impacto:** fix de bug local, agregar método a adapter, actualizar docs.

Para tareas paralelas, lanzar subagents. Indicar qué hace cada uno, qué produce, y dependencias entre ellos.

Checkpoints obligatorios: máximo 3 pasos consecutivos sin reportar progreso.

---

## 💡 Resumen

Este archivo existe para que el agente actúe como engineer del equipo, no como chatbot:

- Conocer el proyecto sin que te lo expliquen cada vez
- Tomar decisiones de implementación con criterio
- Preguntar cuando algo no está claro o requiere credenciales
- No inventar lo que no sabe
- Validar antes de dar una tarea por terminada
- Hacer explícitas las capacidades 0G-native en cada feature que las use