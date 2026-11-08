# Big picture

How a released loan moves from the MyLoans lookup to the vault gate.

Last updated: 8 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  S1["MyLoans lookup by PN and data check"]:::sys
  S1 -->|"Fails: field named, nothing saved"| S1b["LA or MyLoans owner fixes the data, searches again"]:::la
  S1b --> S1
  S1 -->|Passes| S2["Automatic rules 1 to 4: classification, Mortgage or not, transactions created"]:::sys
  S2 --> L1["LA checks the papers, asks for missing ones, answers the funds question"]:::la
  L1 --> L2{"Which transaction?"}
  L2 -->|"EDST: no processor"| L3["LA records the EDST reference"]:::la
  L3 --> DONE1["EDST completed"]:::sys
  L2 -->|"Notary, Entry of PPSR, Mortgage"| L5["LA sends to a Document Processor"]:::la
  L5 -->|"Before the DP accepts"| L6["LA can update, change or pull back"]:::la
  L5 --> D1["DP reviews the job"]:::dp
  D1 -->|Decline| L1
  D1 -->|Accept| D2["DP works the stages: notary or PPSR, cash advance, LTO drop off and pickup"]:::dp
  D2 -->|"Papers missing or wrong"| D3["Return to LA: papers needed"]:::dp
  D3 --> L1
  D2 --> D5["DP checks and verifies that all papers are complete"]:::dp
  D5 -->|"Something missing"| D6["Problem, find it, verify again"]:::prob
  D6 --> D5
  D5 -->|"All complete"| D4["DP chooses the branch and the named LA, then forwards the package"]:::dp
  D4 --> R1["Receiving LA records Complete, Incomplete or Other"]:::la
  R1 -->|"Incomplete or blocking"| R2["DP is told, corrects and forwards again"]:::dp
  R2 --> R1
  R1 -->|Complete| R3["Transaction completed, DP job closed"]:::sys
  R3 --> G{"All transactions complete and all funds settled?"}
  G -->|No| WAIT["Wait for the others"]:::sys
  G -->|Yes| V1["For Vault transmittal"]:::later
  V1 --> V2["Vault, DigiCur, pull-out, QA, closure and archival"]:::later
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
  classDef prob fill:#fbe0dc,stroke:#b3261e,color:#14213a
  classDef later fill:#ffffff,stroke:#8b94a5,stroke-dasharray:5 4,color:#3a4658
```

- EDST is done by the LA alone. Notary, Entry of PPSR and Mortgage go to a Document Processor.
- At the LTO the DP drops off the papers, picks them up, then checks and verifies that every paper is back and complete.
- Only then does the DP forward the package. **The DP chooses the branch and the named LA. Forwarding is never automatic.**
- The loan reaches the vault stage only when every transaction is complete and all funds are settled.

[Back to the workflow index](README.md)
