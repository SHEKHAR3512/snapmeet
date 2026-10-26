import { z } from 'zod';

// Meet enforces Trusted Types/CSP. zod's JIT probes `new Function`, which would emit CSP
// violation reports to the page even though zod catches the error. Disable it everywhere.
z.config({ jitless: true });

export { z };
