# tiny-stack-vm

A faithful interpreter of make.fun's tiny stack ISA v1 for the bounty
`tiny-stack-vm-01-run-20261122` — "Build a tiny stack virtual machine,
22 November 2026" ($100 pot).

`main.ts` (Node 22, stdlib only) runs every program in a set in one run:
for each instance it reads `program.bin` / `input.bin`, executes the
program exactly per `ISA.md` and the reference VM `vm.mjs` — 32-bit
wrapping arithmetic with exact `MUL`, signed/unsigned division and
comparisons, all ten traps with their exact exit codes, the 1,000,000
step limit and the 65,536-byte output limit — and writes `stdout.bin`
and `exit.txt`.

Referral code: `8z4pvdk9`
