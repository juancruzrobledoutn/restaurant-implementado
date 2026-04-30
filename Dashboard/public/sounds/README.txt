Place ready.mp3 here — a short chime/notification sound (< 1 second).

This file is played by KitchenDisplay.tsx when a round status changes to READY
and audioEnabled === true in kitchenDisplayStore.

Expected path: /sounds/ready.mp3
Usage in code: new Audio('/sounds/ready.mp3').play().catch(() => {})

Recommended: a subtle kitchen-bell or chime sound, royalty-free.
Example sources: https://freesound.org (license: CC0)
