# tdl-mcp

[![CI](https://github.com/rixile9999/tdl-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rixile9999/tdl-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tdl-mcp)](https://www.npmjs.com/package/tdl-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[`tdl`](https://github.com/iyear/tdl) CLI 기반의 읽기 전용 텔레그램 MCP 서버 —
Claude를 비롯한 모든 MCP 호스트에서 내 텔레그램을 읽을 수 있게 해줍니다.**

내 텔레그램 계정의 채팅 목록 조회, 최근 메시지 읽기, 미디어 파일 다운로드를
다섯 개의 간단한 도구로 제공합니다. 메시지를 **보내지 않고**, 아무것도
**수정하지 않으며**, 로그인에도 **관여하지 않습니다**.

🇬🇧 [English documentation → README.md](README.md)

## 왜 tdl-mcp인가요?

대부분의 텔레그램 MCP 서버는 MTProto 라이브러리(Telethon, gramjs 등)를 내장하고,
`my.telegram.org`에서 직접 텔레그램 앱을 등록해 `api_id`/`api_hash`를 발급받게
하며, 상당수는 내 계정으로 메시지를 **보낼 수도** 있습니다.

`tdl-mcp`는 의도적으로 단순한 길을 택했습니다:

- **설계부터 읽기 전용.** 채팅 목록 조회, 메시지 내보내기, 파일 다운로드 —
  그게 전부입니다. 전송·수정·삭제·로그인하는 코드 경로 자체가 없습니다.
- **`api_id`/`api_hash` 설정 불필요.** 로그인은 터미널에서 `tdl login -T qr`
  한 번이면 끝 — 휴대폰으로 QR 코드만 스캔하면 됩니다. 텔레그램 앱 등록이
  필요 없습니다.
- **검증된 다운로더 위에 구축.** [`tdl`](https://github.com/iyear/tdl)(7.5k+ ⭐)이
  핵심 작업을 담당합니다: 빠른 병렬 다운로드, 이어받기, `--skip-same` 중복 방지.
- **작고 감사(audit)하기 쉬움.** 순수 JavaScript 파일 하나, 의존성 둘
  (`@modelcontextprotocol/sdk`, `zod`), 빌드 과정 없음. 서버 전체 코드를
  5분이면 다 읽을 수 있습니다.

```
Claude / MCP 호스트  ←stdio→  tdl-mcp (Node)  →서브프로세스→  tdl CLI  →MTProto→  텔레그램
```

## 빠른 시작

### 1. tdl 설치

```sh
# macOS
brew install telegram-downloader

# Linux / WSL
curl -sSL https://docs.iyear.me/tdl/install.sh | sudo bash

# Windows (PowerShell)
iwr -useb https://docs.iyear.me/tdl/install.ps1 | iex
```

[`.tdl-version`](.tdl-version)에 고정된 버전 이상이면 동작합니다 — CI가 그
버전 기준으로 계속 테스트합니다([호환성](#호환성--최신-상태-유지) 참고).

### 2. 텔레그램 로그인 (최초 1회)

```sh
tdl login -T qr
```

텔레그램 모바일 앱(**설정 → 기기 → 데스크톱 기기 연결**)으로 QR 코드를
스캔하세요. 세션은 내 컴퓨터의 `~/.tdl`에 저장되어 모든 MCP 호스트가
공유합니다 — 로그인은 딱 한 번이면 됩니다. `tdl-mcp` 자체는 로그인을
수행하거나 갱신하지 않습니다.

### 3. MCP 호스트에 서버 등록

Node.js 18 이상이 필요합니다.

**Claude Code:**

```sh
claude mcp add --scope user telegram -- npx -y tdl-mcp
```

**Claude Desktop 등 다른 MCP 호스트** (일반 `mcpServers` JSON):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "tdl-mcp"]
    }
  }
}
```

### 4. 사용해 보기

어시스턴트에게 이렇게 물어보세요:

> *"내 텔레그램 채팅 목록 보여줘. 퀀트 트레이딩 관련 방 찾아줘."*
>
> *"@some_channel의 최근 메시지 20개 보여줘."*
>
> *"그 채널에서 메시지 1500번 이후에 올라온 PDF 전부 ~/Papers에 받아줘."*

도구가 "로그인되어 있지 않다"고 답하면 터미널에서 `tdl login -T qr`을 실행한
뒤 다시 시도하면 됩니다 — 수동 작업은 그것뿐입니다.

## 도구 목록

| 도구 | 인자 | 기능 |
| --- | --- | --- |
| `tg_status` | — | tdl 세션 로그인 여부 확인. 절대 에러를 내지 않음: `{logged_in:true, chats:N}` 또는 `{logged_in:false, hint}` 반환. |
| `tg_chats` | `filter?` | 대화 목록을 `[{id, type, name, username}]`로 반환. `filter`는 이름/유저명/id에 대한 대소문자 무시 부분 일치. |
| `tg_messages` | `chat`, `last_n?` (기본 50, 최대 500), `since_id?`, `with_text?` (기본 true) | 채팅의 최근 미디어 메시지를 간결한 `{id, date, file, text}` 객체로 내보냄 (최대 200개 반환, 잘림 여부 표시). `since_id`로 특정 id 이후 메시지만 가져오기 — 증분 읽기에 유용. |
| `tg_download` | `chat`, `since_id?`, `last_n?` (기본 100), `extensions?` (csv, 예: `"xlsx,pdf"`), `dest?` (기본 `~/Downloads/telegram`) | 채팅의 미디어를 `--skip-same`으로 다운로드. 새로 받은 파일들의 절대 경로를 반환하고, 해당 없으면 친절한 안내 메시지 반환. |
| `tg_download_url` | `urls` (`https://t.me/...` 링크 배열), `extensions?`, `dest?` | 특정 메시지 링크의 미디어를 다운로드. 모든 url이 `https://t.me/`로 시작하는지 검증. |

`chat`에는 `tg_chats`가 보여주는 숫자 id 또는 `@username`/도메인을 그대로
넣으면 됩니다.

## 환경 변수

| 변수 | 효과 |
| --- | --- |
| `TDL_BIN` | tdl 바이너리 경로. 기본값: `PATH`의 `tdl`, 없으면 `/opt/homebrew/bin/tdl`로 폴백 (GUI로 실행된 MCP 호스트는 Homebrew `PATH`를 물려받지 못하는 경우가 많음). |
| `TDL_NS` | tdl 네임스페이스. 모든 호출에 `-n <ns>`로 전달. 여러 텔레그램 계정/세션을 분리할 때 사용. |

호스트의 서버 설정에서 이렇게 지정합니다:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "tdl-mcp"],
      "env": { "TDL_NS": "work" }
    }
  }
}
```

## 호환성 & 최신 상태 유지

`tdl-mcp`는 tdl CLI를 서브프로세스로 호출하므로, 실질적 의존성은 tdl의
명령줄 인터페이스입니다. 이 인터페이스는 자동으로 보호됩니다:

- [`.tdl-version`](.tdl-version)이 이 패키지가 테스트된 tdl 릴리스를
  고정합니다.
- [`scripts/contract.mjs`](scripts/contract.mjs)가 — 로그인 없이 — 서버가
  사용하는 모든 플래그(`chat ls -o json`, `chat export
  -c/-T/-i/-o/--with-content`, `dl -f/-u/-i/-d/--skip-same`, 전역 `-n`)가
  해당 tdl 바이너리에 여전히 존재하는지 검증합니다. CI가 모든 push/PR마다
  실행합니다.
- 예약 워크플로가 [tdl 릴리스](https://github.com/iyear/tdl/releases)를
  감시합니다. 새 버전이 나오면 새 바이너리로 계약 테스트를 돌리고 릴리스
  노트에서 호환성 파괴 마커를 스캔합니다. 평범한 업데이트는 단순 버전 범프
  PR로, 의심스러운 변경은 래퍼 코드를 직접 수정하는 AI 보조 업그레이드 PR로
  처리됩니다.

따라서 고정 버전보다 새 tdl을 쓰고 있어도 대부분 그냥 동작하며, 혹시
안 되더라도 이 저장소가 사용자보다 먼저 알아냅니다.

## 개발

```sh
git clone https://github.com/rixile9999/tdl-mcp.git
cd tdl-mcp
npm install
npm test          # smoke (MCP 프로토콜, 로그인 불필요) + contract (tdl CLI 인터페이스)
```

- `npm run smoke` — 서버를 stdio로 띄워 도구 카탈로그, `tg_status` 형태,
  입력 검증을 확인합니다. 로그인 여부와 무관하게 통과합니다.
- `npm run contract` — 설치된 tdl 바이너리가 서버가 사용하는 CLI 인터페이스를
  제공하는지 확인합니다. 다른 버전으로 테스트하려면
  `scripts/install-tdl.sh [vX.Y.Z]`로 특정 릴리스(체크섬 검증)를 설치하세요.

PR 환영합니다. 단, 서버는 읽기 전용으로 유지해 주세요 — 전송·수정·삭제
도구는 이 프로젝트의 범위 밖입니다.

## 보안 주의사항

- `~/.tdl`의 tdl 세션은 **계정 전체를 제어할 수 있는 자격 증명**입니다 —
  읽을 수 있는 사람은 누구든 내 텔레그램 계정으로 행동할 수 있습니다. SSH
  키처럼 보호하세요: 저장소, 공유 백업, 다른 기기로 복사하지 마세요.
- `tdl-mcp`는 세션을 읽거나 전송하지 않습니다. 로컬에서 `tdl` 바이너리를
  실행할 뿐이며, tdl 자신의 텔레그램 트래픽 외에는 아무것도 컴퓨터 밖으로
  나가지 않습니다.
- 다운로드는 지정한 디렉터리(`dest`)로 저장됩니다. 기본값은
  `~/Downloads/telegram`입니다.

## 텔레그램 이용약관 관련

tdl은 봇이 아니라 일반 사용자 세션(MTProto)을 사용합니다. 자기 계정에 대한
조용한 읽기 전용 개인 자동화는 일반적으로 용인되지만, 공격적인 크롤링은
계정 제한으로 이어질 수 있습니다: 범위를 적당히 유지하고(`last_n`,
`since_id`), 대량 병렬 풀을 피하고, 재다운로드 대신 `--skip-same`에 맡기세요.

## 라이선스

이 저장소의 모든 코드는 [MIT](LICENSE)입니다.

`tdl`은 [AGPL-3.0](https://github.com/iyear/tdl/blob/master/LICENSE)으로
배포되는 별개의 프로젝트입니다. `tdl-mcp`는 tdl을 번들·링크·수정하지 않고,
사용자가 직접 설치한 바이너리를 별도 프로세스로 호출만 하므로 AGPL은 tdl에만
적용되고 이 래퍼에는 적용되지 않습니다. tdl은 위 1단계의 공식 채널로 직접
설치하면 됩니다.
