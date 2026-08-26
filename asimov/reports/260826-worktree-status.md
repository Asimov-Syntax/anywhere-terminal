# anywhere-terminal status — 2026-08-26

> **TL;DR**
> - Worktree View feature: **4 / 17 tasks đóng (24%)**, Phase 1–2 xong, Phase 3 là việc kế tiếp — chưa có task nào đang chạy.
> - Đã tiêu **115.9M billable token** cho 3 change worktree; **87% rơi vào phase plan**, chỉ 13% vào build.
> - Không còn change nào active — hai change ngoài roadmap đã được dọn ở `415b6fe`; đường đi tiếp theo trống.
>
> **Ask:** None.

| As of | Overall | Scope | Schedule | Quality | Cost / usage |
| --- | --- | --- | --- | --- | --- |
| 2026-08-26 09:26 +07 | Amber | Green | Amber | Green | 115.9M billable token (không có ngân sách đặt trước) |

Amber ở **Overall** và **Schedule** vì cùng một lý do: ước lượng P4/P5/P6 đã bị nâng lên tại peer review 2026-08-25 — còn ~28–36 ngày công cho 13 task còn lại, và chưa có task nào đang chạy.

## Progress

- **Worktree View & Agent Presence** — 4 / 17 task (24%). Xong: `WT-001.1` discovery, `WT-001.2` cache+broadcast, `WT-002.0` visual design, `WT-002.1` panel shell. Cả 4 đóng trong 26 giờ qua (25/08 → 26/08).
- **Milestone Stage 1** — 4 / 9 issue đóng. Stage 2–5 chưa mở việc nào.
- **Đang chạy** — không có. Phase 3 (`WT-003.1`, `WT-003.2`) đều `todo`.
- **Ngoài roadmap** — không còn. Commit `415b6fe "chore: cleanup invalid change"` (08:46) đã xóa cả `support-cursor-integration` lẫn `fix-claude-terminal-respawn` khỏi `asimov/changes/`, kèm spec `cursor-host-compatibility`. `asm change list` giờ trả về *No active changes*.

```text
P1 ✅✅  P2 ✅✅  P3 ⬜⬜  P4 ⬜⬜⬜⬜  P5 ⬜⬜⬜  P6 ⬜⬜⬜  P7 ⬜
 xong    xong    2d      8-11d       8-10d    8-11d    2d
```

## Token — 3 change có ledger

| Change | Plan | Build | Billable | Msg |
| --- | ---: | ---: | ---: | ---: |
| enumerate-git-worktrees | 51.3M | — | **51.3M** | 307 |
| cache-and-broadcast-worktree-tree | 43.1M | 14.6M | **57.7M** | 273 |
| add-worktree-panel-shell | 7.0M | — | **7.0M** | 22 |
| **Tổng** | **101.3M (87%)** | **14.6M (13%)** | **115.9M** | 602 |

Đọc thêm: 110.4M / 115.9M (95%) là **cache read** — đã được cache-hit chứ không phải input tươi. Output thật chỉ 450K token.

Phân bổ agent (chỉ `enumerate-git-worktrees` có review chạy): main agent `claude-opus-5` 45.4M, sáu review agent (`gpt-5.6-*`, `claude-sonnet-5`) cộng lại 5.9M — tức multi-agent review tốn ~13% chi phí của change đó.

**Owner**: toàn bộ 4 change worktree do `huybuidac@gmail.com` chạy trên runtime `claude`, một mình.

## GitHub — `Asimov-Syntax/anywhere-terminal`

- Issues: 4 closed / 19 total. 13 issue mở đều là task `WT-*` đã sync từ `docs/PLAN.md`, cộng 2 feature request cũ (#7 Cursor CLI, #3 rename tab).
- Milestones: Stage 1 (5 open / 4 closed) · Stage 2 (3) · Stage 3 (1) · Stage 4 (3) · Stage 5 (1).
- PRs: 5 merged, 0 open. Đóng góp ngoài: `daoan` (3 PR clipboard/Windows), `ertugrulsagdic` (1 PR keybinding).
- Commit 90 ngày: huybuidac 220, daoan 5, Bui Dac Huy 4, Ertuğrul Sağdıç 3.

## Rủi ro và quyết định

| State | Vấn đề | Tác động | Mitigation / ask |
| --- | --- | --- | --- |
| Green | Cursor compatibility | Đã xong trên thực tế: `engines.vscode ^1.105.0`, `@types/vscode 1.105.0`, README có hướng dẫn cài Cursor — tất cả đã ở `main`. Bằng chứng verify (Cursor 3.18.0 CLI cài được `huybuidac.anywhere-terminal@0.18.1`, không bị chặn `engines.vscode`) đã có nhưng bị loại bỏ cùng change folder theo quyết định cleanup | Còn lại: đóng issue #7 nếu thấy hợp lý |
| Amber | Hồ sơ asimov của 2 change đã bị xóa ở `415b6fe`, không archive | Mất dấu vết quyết định; muốn làm lại `fix-claude-terminal-respawn` phải plan từ đầu (pointer cũ: bundle Claude ở `~/.local/share/claude`, de-minify theo `claude-code-patch-skills`) | Chấp nhận theo quyết định 2026-08-26; khôi phục được từ `415b6fe^` nếu đổi ý |
| Amber | Tỉ lệ plan:build = **7:1** token | Nếu giữ nguyên, 13 task còn lại sẽ tốn nhiều hơn ước lượng ngày công gợi ý | Cân nhắc giảm ceremony cho task size S/XS (P3 cả hai đều S/XS) |
| Amber | Ledger analytics chỉ có ở **3 / 71** change archive (4%) | Không vẽ được xu hướng chi phí, không so sánh được với giai đoạn trước | Chấp nhận — hook analytics mới thêm ở commit `45f947a` (2026-08-26), từ giờ sẽ đủ dữ liệu |
| Amber | `main` **ahead 7 commit** chưa push | Việc đã merge chưa ai thấy | Push khi sẵn sàng |
| Green | Chất lượng | typecheck sạch, 178 file / 3274 test pass; 57K dòng test trên 98K dòng source | Không cần hành động |

## Next steps

1. **huybuidac**: mở change cho `WT-003.1` (Wire Real Data & Persist View State, size S) — task duy nhất sẵn sàng, chỉ phụ thuộc WT-001.2 + WT-002.1 đều đã xong. Worktree `asimov/wire-live-worktree-tree` đã được tạo sẵn cho việc này.
2. **huybuidac**: push 7 commit đang chờ.
3. **huybuidac**: cân nhắc đóng issue #7 (Cursor CLI) — bản fix đã ship trong `main`.

## Evidence

- `bun run asm analytics list` · `bun run asm analytics show <id>`
- `asimov/changes/*/workflow.md` · `docs/PLAN.md`
- `gh issue list --state all` · `gh api repos/Asimov-Syntax/anywhere-terminal/milestones`

## Changelog

- 2026-08-26 09:26 +07 — Sửa sau khi commit `415b6fe` được phát hiện: Cursor risk hạ từ Red xuống Green (fix đã ship, change bị cleanup theo chủ ý), bỏ mục change treo, cập nhật ahead 5 → 7 commit. Worktree `cache-and-broadcast-worktree-tree` đã gỡ bỏ; phần việc chưa commit trong đó bị loại theo quyết định của chủ repo.
