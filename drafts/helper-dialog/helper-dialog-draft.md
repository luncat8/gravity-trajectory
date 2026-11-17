
разработать концепцию капитана база - помощника (H-helper). Для начала польза от него - информация для игрока (P-player). можно открыть диалог и выбрать вопросы
Продумать типичные вопросы и дерево ответов и систему которая будет динамически их формировать.

Пример:

P: - не могу улететь с планеты. что делать?
H:
	- Планета слишком тяжелая и нет нужного EMC - его надо построить.
		Но у тебя нет денег на стройку или исследование.
			* Ты можешь улететь на коммерческом эвакуаторе
			* ты можешь подождать немного и взять взятку. учти это доступно только один раз пока ты не посетишь др планету
			* или подождать пока кто-то купит EMC или топливо на твоей базе на одной из планет. *но у тебя таких нет*
	- у тебя сломан корабль надо починить в местной мастерской. [repair btn in dialog]
		Но у тебя нет денег.
			...

P:
- Нет денег
	- Деньги можно получить за пролёт мимо планет с работающим наблюдательным устройством OBS-1. или взять взятку. Или получить приз в соревновании. Или получить прибыть от продажи на одной из твоих баз  *но у тебя таких нет*.

P:
- В чём смысл жизни?
	- Этот вопрос требует обсуждения в другой обстановке. Что касается работы эмиссара - то её цель собирать данные и передавать их в столицу этого звездного скопления. Откуда другие передадут в столицу галактики и так далее вплоть до столицы всех столиц находящейся вне пространств и времён. Шучу. Надеюсь суть ты понял. Работа не сложная - цирковые навыки приветствуются. <img alt="A circus acrobat is launched from a sci-fi oversized planetary cannon, soaring through the air while holding maritime signal flag and compact aluminium spyglass">

entry point at the moment of the problem or manual call 'h'
i imagine it as - Helper call player if found problem, if call ignored  or problem solved ico disappears

На первом этапе разработки достаточно концепции. потом мы сравним с другими предложениями перед написанием of the implementation plan

→ **open** — three proposals and one merge live in this folder;
`concept-helper-dialog-merged.md` §3 drops everything that is still a plan and
not a mechanic, so H only ever explains what has a button. Nothing is in the
code. Decision: H shows the first launch blocker as its headline and the other
active blockers underneath, in the game's shared `launchReason` order; H does
not invent a second ranking. Example: “Repair your hull first”, then “You need
20 more credits for launch.” The implementation plan must define how the
shared check exposes all active blockers without duplicating launch rules.

→ the entry point is decided in `concept-helper-dialog-merged.md` §4.11: H
raises one icon beside the rule-help button when the player stands behind a
closed `launchReason` gate (tagged with the finding), never a toast and never
text by itself; a dismissal holds for that planet visit, one silent re-call is
allowed when the numbers change, and the icon clears by itself the moment the
gate does — the call is a rendering of the current gate, not a queue. `h` stays
the rule drawer's key (`gravity_gui.js:917`), so the card opens on the button.
