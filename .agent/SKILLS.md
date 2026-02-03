# SKILLS

이 저장소에서 자주 하는 작업 흐름을 간단히 정리합니다.

## 공통 규칙

- 어떤 문서든 변경하면 `npx prettier . --write` 실행.

## 1) 정적 페이지 수정/추가

- 위치: `_pages/`
- 방법: 기존 페이지를 복사해 프런트매터(`layout`, `title`, `permalink` 등)만 조정.
- 참고: 홈/소개는 보통 `about.md`에 있습니다.

## 2) 블로그 글 추가

- 위치: `_posts/`
- 파일명: `YYYY-MM-DD-title.md`
- 방법: 기존 포스트 복사 → 프런트매터(`title`, `date`, `categories`, `tags`) 수정.

## 3) 뉴스 항목 추가

- 위치: `_news/`
- 방법: 기존 뉴스 파일 복사 → `date`, `inline` 유지/조정.

## 4) 프로젝트 추가

- 위치: `_projects/`
- 방법: 기존 프로젝트 복사 → `title`, `description`, `img`, `importance`, `category` 수정.
- 이미지: `assets/img/`에 추가 후 경로 연결.

## 5) 출판물 업데이트

- 위치: `_bibliography/papers.bib`
- 공저자 링크: `_data/coauthors.yml`
- 표시/정렬 옵션: `_config.yml`의 Jekyll Scholar 섹션.
- 논문/아카이브 링크는 `html`, 코드 저장소는 `code` 필드에 추가.
- arXiv 논문은 `eprint`, `archivePrefix={arXiv}`, `primaryClass`, `html`, `abbr={arxiv}` 포함.
- arXiv 링크 ID와 `eprint` 값 일치 확인.

## 6) 소셜/외부 링크 변경

- 위치: `_data/socials.yml`, `_data/repositories.yml`, `_data/cv.yml`
- 방법: 기존 항목 포맷 유지하며 값만 수정.

## 7) 로컬 미리보기

- Docker: `docker compose up`
- Ruby: `bundle exec jekyll serve`
- `_config.yml` 변경 시 서버 재시작 필요.

## 8) 배포 전 정리

- 배포 전에 `npx prettier . --write` 실행.

## 9) 배포 트리거

- `git add -A` → `git commit -m "your message"` → `git push origin main`
