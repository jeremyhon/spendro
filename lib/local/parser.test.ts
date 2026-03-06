import { describe, expect, test } from "bun:test";

import { parseEmbeddedTransactions } from "@/lib/local/parser";

describe("parseEmbeddedTransactions", () => {
  test("parses Citibank card rows and skips credits", () => {
    const text = `
Citibank Singapore Ltd
YOUR BILL SUMMARY
Statement Date January 19, 2026
DATE             DESCRIPTION                                                                 AMOUNT (SGD)
26 DEC           MONEYSEND HON GUANG YU JE                        SG                         (1,535.00)
20 DEC           AGODA.COM METROLUX C                  INTERNET      HK                        177.80
20 DEC           CTY TNHH TT FOOD VIETN TP.HOCHIMINH VN                                     5.84
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-12-20",
      amount: 177.8,
      currency: "SGD",
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-12-20",
      amount: 5.84,
      currency: "SGD",
    });
  });

  test("parses DBS credit card rows and skips CR credits", () => {
    const text = `
Credit Cards
Statement of Account
DBS Cards P.O. Box 360 S(912312)
STATEMENT DATE             14 Dec 2025
DATE              DESCRIPTION                                                                                        AMOUNT (S$)
30 NOV    BILL PAYMENT - DBS INTERNET/WIRELESS                                                                            578.50 CR
13 NOV    WATSONS - BUGIS JUNCTI                                                                                           23.10
22 NOV    TAKASHIMAYA (S) LTD                                                                                               6.00
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-11-13",
      amount: 23.1,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-11-22",
      amount: 6,
    });
  });

  test("parses DBS multiplier account withdrawals only", () => {
    const text = `
Details of Your DBS Multiplier Account
1 Dec 2025 to 31 Dec 2025
DATE                   DESCRIPTION                                                              WITHDRAWAL            DEPOSIT                  BALANCE
30 Nov                 Advice Bill Payment                                                         578.50
07 Dec                 Interest Earned                                                                                 42.98                  23,697.32
02 Dec                 GIRO Standing Instruction                                                  1,226.25                                    26,890.28
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-11-30",
      amount: 578.5,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-12-02",
      amount: 1226.25,
    });
  });

  test("enriches transfer-like account transactions with counterparty", () => {
    const text = `
Details of Your DBS Multiplier Account
1 Feb 2026 to 28 Feb 2026
DATE                   DESCRIPTION                                                              WITHDRAWAL            DEPOSIT                  BALANCE
02 Feb                 PAYNOW-FAST                                                                   9.00                                      84,057.71
                       PIB2602019122460145
                       AK SUPERMARKET PTE.
                       OTHR Transfer - UEN
11 Feb                 Inward DR - GIRO                                                             117.19                                     85,740.52
                       COLL 8936303653
                       SP SERVICES LTD
                       GIRO Collection 8936303653
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2026-02-02",
      description: "PAYNOW-FAST - AK SUPERMARKET PTE.",
      merchant: "AK SUPERMARKET PTE.",
      amount: 9,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2026-02-11",
      description: "Inward DR - GIRO - SP SERVICES LTD",
      merchant: "SP SERVICES LTD",
      amount: 117.19,
    });
  });

  test("parses UOB account withdrawals only", () => {
    const text = `
UOB Privilege Concierge
Statement of Account
Period: 01 Dec 2025 to 31 Dec 2025
Account Transaction Details
Date                     Description                                                                       Withdrawals                       Deposits                      Balance
01 Dec                   Bill Payment                                                                           1,148.11                                               107,280.44
04 Dec                   Inward CR - GIRO                                                                                                    2,200.00                  109,776.64
29 Dec                   Bill Payment                                                                             845.21                                                 91,245.26
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-12-01",
      amount: 1148.11,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-12-29",
      amount: 845.21,
    });
  });

  test("parses DBS/POSB consolidated withdrawals only", () => {
    const text = `
Consolidated Statement
Transaction Details as at 31 Jan 2026
Date           Description                                            Withdrawal (-)      Deposit (+)         Balance
31/12/2025     Advice FAST Payment / Receipt                                                    3.77        29,177.43
04/01/2026     Advice Funds Transfer                                             6.50                       29,564.70
05/01/2026     GIRO Standing Instruction                                    2,200.00                        27,364.70
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2026-01-04",
      amount: 6.5,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2026-01-05",
      amount: 2200,
    });
  });

  test("parses UOB credit card statement rows and skips credits", () => {
    const text = `
Credit Card(s) Statement
Statement Date                                12 FEB 2025
Post           Trans            Description of Transaction                              Transaction Amount
Date           Date                                                                         SGD
18 JAN         16 JAN           SHOPEE SINGAPORE MP SINGAPORE                                17.74 CR
13 JAN         10 JAN           SHOPEE SINGAPORE MP SINGAPORE                                  7.11
13 JAN         13 JAN           STEAM PURCHASE 4259522 DE                                     13.83
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-01-13",
      amount: 7.11,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-01-13",
      amount: 13.83,
    });
  });

  test("parses OCBC card statement rows and skips payment credits", () => {
    const text = `
OCBC Bank
STATEMENT DATE            PAYMENT DUE DATE
   27-09-2025             17-10-2025
TRANSACTION DATE                            DESCRIPTION                              AMOUNT (SGD)
13/09                                      PAYMENT BY INTERNET                    (1,113.82 )
29/08                                      LAU WANG @ BPP                         25.12
18/09                                      GOKUKAKU WAGYU HOTPOT                  88.13
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-08-29",
      amount: 25.12,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-09-18",
      amount: 88.13,
    });
  });

  test("uses per-page DBS account column headers to avoid deposit leakage", () => {
    const text = `
Details of Your DBS Multiplier Account
1 Mar 2025 to 31 Mar 2025
DATE                     DESCRIPTION                     WITHDRAWAL          DEPOSIT                  BALANCE
01 Mar                   Advice FAST Collection               50.00                                  54,192.73
                         Utilities
\f
Details of Your DBS Multiplier Account
1 Mar 2025 to 31 Mar 2025
DATE               DESCRIPTION                                     WITHDRAWAL             DEPOSIT               BALANCE
07 Mar             Advice Funds Transfer                                                       125,943.72
                   107-67604-0 : I-BANK
11 Mar             Debit Card transaction                                       53.96                                  80,948.47
`;

    const parsed = parseEmbeddedTransactions(text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      postedOn: "2025-03-01",
      amount: 50,
    });
    expect(parsed[1]).toMatchObject({
      postedOn: "2025-03-11",
      amount: 53.96,
    });
  });
});
