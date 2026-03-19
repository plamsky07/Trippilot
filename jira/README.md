# Jira Import

Файлът `trippilot-jira-import.csv` е подготвен за импорт като backlog в Jira.

Препоръчано мапване при import:

- `External ID` -> `Issue ID`
- `Parent External ID` -> `Parent ID`
- `Issue Type` -> `Issue Type`
- `Summary` -> `Summary`
- `Description` -> `Description`
- `Epic Name` -> `Epic Name`
- `Priority` -> `Priority`
- `Story Points` -> `Story Points`
- `Sprint` -> `Sprint`
- `Labels` -> `Labels`

Забележки:

- Ако вашият Jira project не позволява директно да върже stories към epics през `Parent ID`, импортнете първо epic-ите, след това story/task редовете и ги свържете през `Epic Link` или `Parent`.
- От тази среда нямам директен достъп до Jira API, затова е подготвен CSV за ръчен import.
