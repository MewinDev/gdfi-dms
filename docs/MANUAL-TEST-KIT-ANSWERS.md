# Manual Test Kit: answers

Last updated: 10 November 2026 (PHT)

What each PN of the [Manual Test Kit](MANUAL-TEST-KIT.md) is and what it is good for. Look here only if you get stuck: the point is to find it out by searching and opening the PN.

All of them are in the sample MyLoans only, released on the day the kit was built (unless it says otherwise), with a car (plate, engine and chassis numbers) and an address. Every loan is opened with **Find loan**, as a real Loan Associate would.

**MyLoans changes.** Nothing changes by itself. For the cases that need MyLoans to change (a Refresh change, a branch move, a unit change), open the loan first, then sign in as **Admin**, open the loan file and use **Simulate a MyLoans change** (amount, name, product, cancel, replace or branch). The change shows after **Refresh** or the next sync, and a material change waits for review.

**Approvals.** Cash advances under ₱5,000.00 go to **Approver Small**; ₱5,000.00 and up to **Approver Large** (Settings, Approval bands). Finance releases.

### Antipolo (101)

| PN | What it is and what it is good for |
|---|---|
| GD1012026903001 | Refinancing, New, ₱650,000: above the ₱500,000 limit, so no Mortgage. |
| GD1012026903002 | Auto Financing, ₱350,000: you pick Undertaking or Non-Undertaking, and Transferred or Untransferred, when opening. |
| GD1012026903003 | Blank product, Renewal, ₱800,000: the rules treat it as Refinancing; Renewal up to ₱1,000,000 needs a Mortgage. |
| GD1012026903004 | New at exactly ₱500,000: Mortgage needed (the limit is included). |
| GD1012026903005 | New at ₱500,001: one peso over, no Mortgage. |
| GD1012026903006 | Released 2 business days ago: Assign to DP is due today (TAT). |
| GD1012026903007 | Released 4 business days ago: Assign to DP is late; Send asks for the late reason (TAT). |
| GD1012026903008 | Same borrower, first unit (CIN shared with GD1012026903009). Open this one first. |
| GD1012026903009 | Same borrower, additional unit: after opening GD1012026903008, Find loan shows it as related (same CIN). |
| GD1012026903010 | MyLoans change after Refresh: open it, then as Admin use Simulate a MyLoans change (amount or name) on its loan file; the change shows only after Refresh or the next sync. |
| GD7772026903011 | Unknown branch code 777 in the PN; MyLoans puts the loan at Antipolo, so it opens at Antipolo (the branch comes from MyLoans, not from the PN). |

### Angono (165)

| PN | What it is and what it is good for |
|---|---|
| GD1652026903012 | Renewal at exactly ₱1,000,000: Mortgage needed. |
| GD1652026903013 | Renewal at ₱1,000,001: no Mortgage. |
| GD1652026903014 | Truck Financing, ₱450,000: pick Non-Undertaking when opening. |
| GD1652026903015 | Auto Financing, ₱300,000: pick Untransferred to get Notary and EDST. |
| GD1652026903016 | Product "Auto Finance" (not the word Financing): treated as Refinancing. |
| GD1652026903017 | Branch moved by MyLoans later: open it, then as Admin Simulate a MyLoans change, Branch; it waits for review until applied. |
| GD1652026903018 | Unit change (replacement): open it, then as Admin Simulate a MyLoans change, Replace; MyLoans gives a new PN and the old one waits for review. |
| GD1652026903019 | Plain Mortgage loan: good for a full Send to DP, Pasuyo between DP 1 and DP 2, and a cash advance for the LTO fee. |

### A. Mabini (168)

| PN | What it is and what it is good for |
|---|---|
| GD1682026903020 | Plain Mortgage loan at A. Mabini: send it to DP 3 and forward to Receiving LA A. Mabini. |
| GD1682026903021 | Plain Mortgage loan at A. Mabini: good for a hold, a missing paper or a problem. |
| GD1682026903022 | Auto Financing at A. Mabini. |
| GD1682026903023 | Renewal at A. Mabini, ₱900,000: Mortgage needed. |
| GD1682026903024 | Refinancing above the limit at A. Mabini (₱700,000): no Mortgage. |
| GD1682026903025 | Released 2 business days ago at A. Mabini: Assign to DP due today. |

### Alaminos (390)

| PN | What it is and what it is good for |
|---|---|
| GD3902026903026 | Plain Mortgage loan at Alaminos: send it to DP 4. |
| GD3902026903027 | Plain Mortgage loan at Alaminos: good for Return to LA with findings. |
| GD3902026903028 | Auto Financing at Alaminos. |
| GD3902026903029 | Renewal at Alaminos, ₱1,000,000: Mortgage needed. |
| GD3902026903030 | Released 4 business days ago at Alaminos: late (TAT). |
| GD3902026903031 | Alaminos is outside Luzon 1: LA Luzon 1 is refused (Outside your branch access). LA Alaminos or Roving LA can open it; Area Supervisor Luzon 1 then sees it (that role views loans but does not open them). |

### Amang Rodriguez (174)

| PN | What it is and what it is good for |
|---|---|
| GD1742026903032 | Amang Rodriguez: LA Luzon 1 is excluded from this branch, so it is refused for them; Roving LA can open it. |
| GD1742026903033 | Amang Rodriguez, second loan: once Roving LA opens it, Area Supervisor Luzon 1 sees it and LA Luzon 1 does not. |

### Cainta (102)

| PN | What it is and what it is good for |
|---|---|
| GD1022026903034 | Cainta (Luzon 1): LA Luzon 1 and Roving LA can open it; LA Antipolo cannot (Outside your branch access). |

### Binangonan (123)

| PN | What it is and what it is good for |
|---|---|
| GD1232026903035 | Binangonan (Luzon 1). |

### Marikina (104)

| PN | What it is and what it is good for |
|---|---|
| GD1042026903036 | Marikina (Luzon 1), Renewal ₱950,000: Mortgage needed. |

### Marcos Highway (163)

| PN | What it is and what it is good for |
|---|---|
| GD1632026903037 | Marcos Highway (Luzon 1), Auto Financing. |

### Mandaluyong (147)

| PN | What it is and what it is good for |
|---|---|
| GD1472026903038 | Mandaluyong (Luzon 1). |

### Libis (155)

| PN | What it is and what it is good for |
|---|---|
| GD1552026903039 | Libis (Luzon 1), released 2 business days ago. |

### Alicia-Inactive (718)

| PN | What it is and what it is good for |
|---|---|
| GD7182026903040 | At Alicia-Inactive (718), a branch MyLoans closed: opening it is refused ("Alicia-Inactive (718) is inactive in Settings, so no new loan files can be opened for it."). |
