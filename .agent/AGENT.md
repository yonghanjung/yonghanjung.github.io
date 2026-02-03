# AGENT

이 저장소는 개인 홈페이지(https://yonghanjung.me/)를 관리하는 Jekyll(al-folio) 기반 프로젝트입니다.

## 작업 원칙

- `_site/`는 빌드 산출물이라 직접 수정하지 않습니다.
- 기존 포맷/프런트매터(YAML)를 최대한 보존하고, 새 콘텐츠는 기존 파일을 복사해 수정합니다.
- YAML에는 탭을 쓰지 말고 공백만 사용합니다.
- 대규모 자동 생성/정리 작업(포맷터, 클린 등)은 요청 시에만 수행합니다.
- 어떤 문서든 변경하면 `npx prettier . --write`를 실행합니다.

## 주요 경로

- 페이지: `_pages/` (예: `about.md`, `publications.md`, `projects.md`)
- 블로그: `_posts/` (파일명 `YYYY-MM-DD-title.md`)
- 컬렉션: `_projects/`, `_news/`, `_books/`, `_talks/`
- 출판물: `_bibliography/papers.bib` (+ 공저자: `_data/coauthors.yml`)
- 데이터: `_data/` (예: `socials.yml`, `cv.yml`, `repositories.yml`, `venues.yml`)
- 테마/레이아웃: `_layouts/`, `_includes/`, `_sass/`
- 에셋: `assets/`
- 설정: `_config.yml`

## 출판물 링크 규칙

- 논문/아카이브 링크는 `papers.bib`의 `html` 필드에, 코드 저장소 링크는 `code` 필드에 둡니다.
- arXiv 논문은 `eprint` + `archivePrefix={arXiv}` + `primaryClass` + `html` + `abbr={arxiv}` 형식으로 정리합니다.
- arXiv 링크 ID와 `eprint` 값이 일치하는지 확인합니다.

## 로컬 미리보기

- Docker(권장): `docker compose pull && docker compose up` (기본 포트 `http://localhost:8080`)
- 로컬 Ruby: `bundle install` 후 `bundle exec jekyll serve` (기본 포트 `http://localhost:4000`)
- `_config.yml` 변경 사항은 Jekyll 재시작이 필요합니다.

## 배포 전 정리

- `npx prettier . --write` 실행.

## 배포

- GitHub Actions 기반 자동 배포(gh-pages). 설정은 `INSTALL.md` 참고.
- 변경사항 반영 후 배포 트리거: `git add -A` → `git commit -m "your message"` → `git push origin main`
