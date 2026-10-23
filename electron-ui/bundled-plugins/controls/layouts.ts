// Controller positions adapted from OpenEmu; see assets/CREDITS.md.
export interface ControllerControl { label: string; key: string; x: number; y: number }
export interface ControllerLayout { name: string; image: string; controls: ControllerControl[] }
export const controllerLayouts: ControllerLayout[] = [
  {
    "name": "Game Boy",
    "image": "controller_gb.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 35.6,
        "y": 65.6
      },
      {
        "label": "Down",
        "key": "down",
        "x": 35.6,
        "y": 73.2
      },
      {
        "label": "Left",
        "key": "left",
        "x": 31.2,
        "y": 69.4
      },
      {
        "label": "Right",
        "key": "right",
        "x": 39.4,
        "y": 69.2
      },
      {
        "label": "B",
        "key": "south",
        "x": 60.0,
        "y": 70.2
      },
      {
        "label": "A",
        "key": "east",
        "x": 68.0,
        "y": 66.8
      },
      {
        "label": "Select",
        "key": "select",
        "x": 43.4,
        "y": 81.2
      },
      {
        "label": "Start",
        "key": "start",
        "x": 51.6,
        "y": 81.2
      }
    ]
  },
  {
    "name": "Game Boy Color",
    "image": "controller_gb.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 35.6,
        "y": 65.6
      },
      {
        "label": "Down",
        "key": "down",
        "x": 35.6,
        "y": 73.2
      },
      {
        "label": "Left",
        "key": "left",
        "x": 31.2,
        "y": 69.4
      },
      {
        "label": "Right",
        "key": "right",
        "x": 39.4,
        "y": 69.2
      },
      {
        "label": "B",
        "key": "south",
        "x": 60.0,
        "y": 70.2
      },
      {
        "label": "A",
        "key": "east",
        "x": 68.0,
        "y": 66.8
      },
      {
        "label": "Select",
        "key": "select",
        "x": 43.4,
        "y": 81.2
      },
      {
        "label": "Start",
        "key": "start",
        "x": 51.6,
        "y": 81.2
      }
    ]
  },
  {
    "name": "Game Boy Advance",
    "image": "controller_gba.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 19.2,
        "y": 47.8
      },
      {
        "label": "Down",
        "key": "down",
        "x": 19.2,
        "y": 54.8
      },
      {
        "label": "Left",
        "key": "left",
        "x": 15.6,
        "y": 51.4
      },
      {
        "label": "Right",
        "key": "right",
        "x": 23.6,
        "y": 51.4
      },
      {
        "label": "B",
        "key": "south",
        "x": 77.4,
        "y": 52.8
      },
      {
        "label": "A",
        "key": "east",
        "x": 84.8,
        "y": 50.0
      },
      {
        "label": "L",
        "key": "leftBumper",
        "x": 16.2,
        "y": 35.0
      },
      {
        "label": "R",
        "key": "rightBumper",
        "x": 83.8,
        "y": 35.0
      },
      {
        "label": "Select",
        "key": "select",
        "x": 24.6,
        "y": 67.8
      },
      {
        "label": "Start",
        "key": "start",
        "x": 24.6,
        "y": 63.0
      }
    ]
  },
  {
    "name": "Famicom",
    "image": "controller_nes.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 21.8,
        "y": 53.0
      },
      {
        "label": "Down",
        "key": "down",
        "x": 21.8,
        "y": 62.4
      },
      {
        "label": "Left",
        "key": "left",
        "x": 17.2,
        "y": 57.8
      },
      {
        "label": "Right",
        "key": "right",
        "x": 26.6,
        "y": 57.8
      },
      {
        "label": "B",
        "key": "west",
        "x": 66.8,
        "y": 62.4
      },
      {
        "label": "A",
        "key": "south",
        "x": 78.2,
        "y": 62.4
      },
      {
        "label": "Select",
        "key": "select",
        "x": 41.2,
        "y": 62.2
      },
      {
        "label": "Start",
        "key": "start",
        "x": 51.2,
        "y": 62.2
      }
    ]
  },
  {
    "name": "Super Famicom",
    "image": "controller_snes_eu.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 25.4,
        "y": 51.6
      },
      {
        "label": "Down",
        "key": "down",
        "x": 25.4,
        "y": 60.4
      },
      {
        "label": "Left",
        "key": "left",
        "x": 21.0,
        "y": 56.0
      },
      {
        "label": "Right",
        "key": "right",
        "x": 30.0,
        "y": 56.0
      },
      {
        "label": "B",
        "key": "south",
        "x": 74.2,
        "y": 63.4
      },
      {
        "label": "A",
        "key": "east",
        "x": 82.8,
        "y": 56.4
      },
      {
        "label": "Y",
        "key": "west",
        "x": 66.2,
        "y": 56.4
      },
      {
        "label": "X",
        "key": "north",
        "x": 74.8,
        "y": 49.6
      },
      {
        "label": "L",
        "key": "leftBumper",
        "x": 24.8,
        "y": 38.4
      },
      {
        "label": "R",
        "key": "rightBumper",
        "x": 76.2,
        "y": 38.4
      },
      {
        "label": "Select",
        "key": "select",
        "x": 42.0,
        "y": 59.0
      },
      {
        "label": "Start",
        "key": "start",
        "x": 51.4,
        "y": 59.0
      }
    ]
  },
  {
    "name": "Nintendo 64",
    "image": "controller_n64.png",
    "controls": [
      {
        "label": "L-Up",
        "key": "leftY.negative",
        "x": 50.0,
        "y": 57.2
      },
      {
        "label": "L-Down",
        "key": "leftY.positive",
        "x": 50.0,
        "y": 65.0
      },
      {
        "label": "L-Left",
        "key": "leftX.negative",
        "x": 46.0,
        "y": 61.2
      },
      {
        "label": "L-Right",
        "key": "leftX.positive",
        "x": 54.0,
        "y": 61.2
      },
      {
        "label": "Up",
        "key": "up",
        "x": 25.4,
        "y": 38.6
      },
      {
        "label": "Down",
        "key": "down",
        "x": 25.4,
        "y": 47.0
      },
      {
        "label": "Left",
        "key": "left",
        "x": 20.8,
        "y": 43.0
      },
      {
        "label": "Right",
        "key": "right",
        "x": 29.8,
        "y": 43.0
      },
      {
        "label": "B",
        "key": "n64B",
        "x": 65.0,
        "y": 45.4
      },
      {
        "label": "A",
        "key": "n64A",
        "x": 70.6,
        "y": 50.8
      },
      {
        "label": "C-Up",
        "key": "rightY.negative",
        "x": 76.6,
        "y": 35.2
      },
      {
        "label": "C-Down",
        "key": "rightY.positive",
        "x": 76.6,
        "y": 44.8
      },
      {
        "label": "C-Left",
        "key": "rightX.negative",
        "x": 71.8,
        "y": 40.0
      },
      {
        "label": "C-Right",
        "key": "rightX.positive",
        "x": 81.4,
        "y": 40.0
      },
      {
        "label": "L",
        "key": "leftBumper",
        "x": 25.0,
        "y": 25.4
      },
      {
        "label": "R",
        "key": "rightBumper",
        "x": 74.8,
        "y": 25.4
      },
      {
        "label": "Z",
        "key": "rightTrigger",
        "x": 50.0,
        "y": 52.8
      },
      {
        "label": "Start",
        "key": "start",
        "x": 50.0,
        "y": 45.8
      }
    ]
  },
  {
    "name": "Mega Drive",
    "image": "controller_genesis.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 28.0,
        "y": 47.0
      },
      {
        "label": "Down",
        "key": "down",
        "x": 28.0,
        "y": 57.0
      },
      {
        "label": "Left",
        "key": "left",
        "x": 22.2,
        "y": 52.2
      },
      {
        "label": "Right",
        "key": "right",
        "x": 33.6,
        "y": 52.2
      },
      {
        "label": "A",
        "key": "west",
        "x": 63.6,
        "y": 60.0
      },
      {
        "label": "B",
        "key": "south",
        "x": 72.4,
        "y": 56.2
      },
      {
        "label": "C",
        "key": "east",
        "x": 81.0,
        "y": 53.6
      },
      {
        "label": "Start",
        "key": "start",
        "x": 48.2,
        "y": 52.0
      },
      {
        "label": "X",
        "key": "leftBumper",
        "x": 60.8,
        "y": 51.4
      },
      {
        "label": "Y",
        "key": "north",
        "x": 68.0,
        "y": 48.0
      },
      {
        "label": "Z",
        "key": "rightBumper",
        "x": 75.4,
        "y": 45.6
      },
      {
        "label": "Mode",
        "key": "select",
        "x": 0.0,
        "y": 100.0
      }
    ]
  },
  {
    "name": "Master System",
    "image": "controller_sms.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 29.0,
        "y": 47.2
      },
      {
        "label": "Down",
        "key": "down",
        "x": 29.0,
        "y": 63.8
      },
      {
        "label": "Left",
        "key": "left",
        "x": 21.4,
        "y": 54.8
      },
      {
        "label": "Right",
        "key": "right",
        "x": 36.8,
        "y": 54.8
      },
      {
        "label": "A",
        "key": "west",
        "x": 66.6,
        "y": 59.6
      },
      {
        "label": "B",
        "key": "south",
        "x": 80.6,
        "y": 59.6
      },
      {
        "label": "Start",
        "key": "start",
        "x": 0.0,
        "y": 100.0
      }
    ]
  },
  {
    "name": "Game Gear",
    "image": "controller_gamegear.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 14.6,
        "y": 46.4
      },
      {
        "label": "Down",
        "key": "down",
        "x": 14.6,
        "y": 54.4
      },
      {
        "label": "Left",
        "key": "left",
        "x": 11.0,
        "y": 50.4
      },
      {
        "label": "Right",
        "key": "right",
        "x": 19.0,
        "y": 50.4
      },
      {
        "label": "Start",
        "key": "start",
        "x": 80.0,
        "y": 42.4
      }
    ]
  },
  {
    "name": "PC Engine",
    "image": "controller_tg16.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 20.4,
        "y": 54.0
      },
      {
        "label": "Down",
        "key": "down",
        "x": 20.4,
        "y": 62.0
      },
      {
        "label": "Left",
        "key": "left",
        "x": 16.0,
        "y": 58.0
      },
      {
        "label": "Right",
        "key": "right",
        "x": 26.0,
        "y": 58.0
      },
      {
        "label": "Select",
        "key": "select",
        "x": 45.0,
        "y": 62.0
      },
      {
        "label": "Run",
        "key": "start",
        "x": 55.0,
        "y": 62.0
      }
    ]
  },
  {
    "name": "Neo Geo Pocket",
    "image": "controller_ngp.png",
    "controls": [
      {
        "label": "Up",
        "key": "up",
        "x": 20.0,
        "y": 48.0
      },
      {
        "label": "Down",
        "key": "down",
        "x": 20.0,
        "y": 52.0
      },
      {
        "label": "Left",
        "key": "left",
        "x": 18.0,
        "y": 50.0
      },
      {
        "label": "Right",
        "key": "right",
        "x": 22.0,
        "y": 50.0
      },
      {
        "label": "A",
        "key": "south",
        "x": 75.6,
        "y": 50.0
      },
      {
        "label": "B",
        "key": "east",
        "x": 83.6,
        "y": 43.2
      },
      {
        "label": "Option",
        "key": "start",
        "x": 83.6,
        "y": 33.0
      }
    ]
  },
  {
    "name": "WonderSwan",
    "image": "controller_ws.png",
    "controls": [
      {
        "label": "Y1",
        "key": "leftBumper",
        "x": 14.4,
        "y": 36.0
      },
      {
        "label": "Y2",
        "key": "leftTrigger",
        "x": 19.6,
        "y": 41.0
      },
      {
        "label": "Y3",
        "key": "rightBumper",
        "x": 14.4,
        "y": 46.0
      },
      {
        "label": "Y4",
        "key": "rightTrigger",
        "x": 9.6,
        "y": 41.0
      },
      {
        "label": "X1",
        "key": "up",
        "x": 14.4,
        "y": 61.6
      },
      {
        "label": "X2",
        "key": "right",
        "x": 19.6,
        "y": 66.4
      },
      {
        "label": "X3",
        "key": "down",
        "x": 14.4,
        "y": 71.2
      },
      {
        "label": "X4",
        "key": "left",
        "x": 9.6,
        "y": 66.4
      },
      {
        "label": "B",
        "key": "south",
        "x": 86.6,
        "y": 71.2
      },
      {
        "label": "A",
        "key": "east",
        "x": 91.6,
        "y": 66.0
      },
      {
        "label": "Start",
        "key": "start",
        "x": 43.6,
        "y": 76.2
      }
    ]
  }
];
