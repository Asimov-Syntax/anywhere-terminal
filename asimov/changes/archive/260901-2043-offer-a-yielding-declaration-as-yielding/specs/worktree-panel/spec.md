# Spec Delta: worktree-panel

## ADDED Requirements

### Requirement: A declaration that will yield is offered as yielding

WHERE a declared entry may name the same destination as the repository's own declaration, the
dialog SHALL offer it unselected and SHALL say that it will be refused while the repository's own
remains selected, and SHALL NOT count it among the entries it says will be brought over.

#### Scenario: The inherited spelling is offered beside the repository's own

- **WHEN** the offer contains two declarations that may name one destination and one of them is the
  repository's own
- **THEN** the repository's own is selected and the other is not, and the other says it will be
  refused while its counterpart stays selected

#### Scenario: The summary counts only what will arrive

- **WHEN** such a pair is offered
- **THEN** the summary counts the repository's own declaration and not the one that will yield

#### Scenario: Nothing is favoured

- **WHEN** two declarations may name one destination and neither is the repository's own
- **THEN** both stay selected, because nothing decides between them and unselecting either would
  pick a winner the apply does not
