# **App Name**: RanChat

## Core Features:

- Video Call: Enables real-time video communication between users.
- Text Chat with Media: Allows users to exchange text messages, images, and videos during the video call.
- Microphone Support: Captures and transmits audio from the user's microphone.
- Skip Chat Button: Lets users skip the current chat and find a new one (with a 3-second cooldown).
- Stop Chat Button: Allows users to end the current chat (with a confirmation dialog). If they stop it goes back to the home page
- Mic/Cam Toggle: Provides buttons to turn the microphone and camera on or off.
- Username Input: Requires users to input a name via a pop-up when starting a chat.
- Gender Selection: Allows users to choose their gender (Male/Female) and preferred gender to match with (Male, Female, Both) for a higher chance of matching.
- Firestore Presence Tracking: Stores data about active users in Firestore, adding when they connect and removing when they disconnect. Has a live user count on the home page
- Firestore Chat Data Management: Stores chat data in Firestore while users are connected and deletes all data after the chat ends.
- Queue Page: A second page for when I am in called or in the queue an have a animation when searching

## Style Guidelines:

- Primary color: Deep blue (#306998), inspired by the desired dark blue aesthetic.
- Background: Dark blue to black gradient for a modern and immersive feel.
- Accent color: Magenta (#FF00FF) for highlighting interactive elements, per user request.
- Body and headline font: 'Inter', sans-serif, for a clean and modern appearance.
- Chat box and camera views are prominently displayed upon entering the site.
- Use simple and clear icons for buttons like skip, stop, mic on/off, and camera on/off.
- Subtle animations for button states and transitions for improved user feedback.