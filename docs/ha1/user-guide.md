FPGA Architect User Guide

# Why does this exist

During FPGA development, from conception to final delivery, there are a multitude of tools used for design, documentation, and verification.
Information is maintained in several data formats:
   - Word documents (or equivalent)
   - Visio diagrams (or equivalent)
   - Various text files

FPGA Architect is an attempt to replace the multitude of tools with a single database that can render documentation, diagrams, etc...

FPGA Architect is designed to allow the user to decide when the value proposition is done.
Only the information needed to perform a particular task is needed.
Additional information can be added if additional value is required.

# Features

- Documentation
- Resource Utilization Visualization
- Architecture exploration
- Component library

# Model Structure

The structure of the system is represented by components such as CCAs, FGPAs, HW, and programmable logic.
The figure below show the relationship between all the componenets:

```
              System Sheet
                   ^
                   |
                  CCA
                   ^
                   |
                CCA Sheet
                   ^
                   |
            +------+------+
            |             |
           HW            FPGA
                           ^
                           |
                       FPGA Sheet
                           ^
                           |
    +-------------+--------+--+---------+---------+
    |             |           |         |         |
Hard Macro  Vendor IP  Register File   RTL    Subsystem
                                                  ^
                                                  |
                                            Subsystem Sheet
                                                  ^
                                                  |
    +-------------+--------+--+---------+---------+
    |             |           |         |         |
Hard Macro  Vendor IP  Register File   RTL    Subsystem
```

Components such as CCA, FPGA, and Subsystem each have a sheet associated with it.
This sheet is where additional components can be added to show its' contents.
Components are restricted to certain sheets.
For example, a Hard Macro can not exist on a CCA Sheet.

Multiple components of the same type can exist on a single sheet.
Multiple levels of hierarchy can be modeled using Subsystems.

## System Sheet

This is the top of the model.
It contains everything in the system.
The only allowed components at this level are CCAs.

## CCA

The CCA component represents circuit cards in the system.
These hold hardware and FPGA components.

## CCA Sheet

The CCA sheet contains the hardware and FPGA components.
It also contains the connections between these components.

## HW

The HW component represents items on the CCA that are not programmable logic.
These are components such as ADCs, DACs, and processors.

## FPGA

The FPGA component represents programmable logic devices.
This can include bare FPGAs or FPGAs with embedded processors.

## FPGA Sheet

The FPGA sheet represents the components inside the FPGA.
This includes Hard Macros, Vendor IP, Custom RTL, Register Files, and Subsystems.
The connections between components are created on this sheet.
Clock assignments are also defined on this sheet.

## Hard Macro

Hard Macro components represent parts of the FPGA die that are not programmble.
Examples include processor subsystems, PCIe interfaces, Ethernet MACs.

## Vendor IP

Vendor IP components represent soft core IP from the FPGA or a third party.

## Register File

Register File components represent control and status registers software can access.

## RTL

The RTL components represent custom HDL that exists as company IP or logic that must be created.

## Subsystem

The subsystem component represents a hierarchical division of logic.
Subsystems can be used to isolate logic that is related.
Examples include an Ethernet or PCIe subsystem.
All components associated with those subsystems can be grouped together.

## Subsystem Sheet

The Subsystem sheet represents the components required to create the subsystem.
The components in this sheet are limited to Hard Macro, Vendor IP, RTL, Register File, and Subsystem.
Subsystems can be nested to improve abstraction.
Clock assignments are also defined on this sheet.

# Scenarios

## I want to architect a single FPGA

Every new effort in FPGA Architect starts with a blank system sheet.
Architecting a single FPGA involves the following tasks.

1. [Add a CCA component to the system sheet](#add-a-cca-component-to-the-system-sheet)
2. [Open CCA component sheet](#open-cca-component-sheet)
3. [Add an FPGA component to the CCA sheet](#add-an-fpga-component-to-the-cca-sheet)
4. [Add all HW components](#add-a-hardware-component-to-the-cca-sheet) that interface with the FPGA to the CCA sheet
5. [Create connections](#create-a-connection-between-to-components) between all hardware components and the FPGA
6. [Open FPGA component sheet](#open-fpga-component-sheet)
7. [Add any Hard Macro](#add-a-hard-macro-component-to-the-fpga-sheet) components used in the FPGA
8. [Add any Vendor IP](#add-a-vendor-ip-component-to-the-fpga-sheet) components used in the design
9. [Add any custom logic components](#add-an-rtl-component-to-the-fpga-sheet) used in the design
10. [Add any components from component library](#add-component-from-component-library) used in the design
11. [Add subsystems](#add-a-subsystem-component-to-the-fpga-sheet) to organize the components or abstract parts of the design
12. [Create connections](#create-a-connection-between-to-components) between all components add to the FPGA sheet
13. [Open each subsystem](#open-a-subsystem-sheet)
14. Continue to add Hard Macros, Vendor IP, custom logic, subsystems, and library components as needed until the entire design is completed

At this point you will have fleshed out the entire FPGA architecture or learned where more information is required.

## I want to architect the clock tree of an FPGA

1. Left click on CCA sheet that contains the FPGA in the sheet navigation bar
2. [Add input and output clocks](#create-clock-ports-on-components) to the FPGA component
3. [Open FPGA component sheet](#open-fpga-component-sheet)
4. [Add input and output clocks](#create-clock-ports-on-components) to every component in the FPGA
5. [Assign clocks](#assign-clocks-to-components) in the FPGA sheet and each subsystem

## I want to view the clock diagram of an FPGA

1. [Open clock diagram](#open-clock-diagram)

## I want to see a hierarchical view of the system

1. [Open deployment diagram](#open-deployment-diagram)

## I want to create a Vendor IP component and add it to the component library

The component library provides components that have previously been created.
They provide a quick way to build an FPGA.
New components can be added at any time to aid in building more FPGAs.

1. [Navigate to FPGA sheet]()
2. [Add a Vendor IP component](#add-a-vendor-ip-component-to-the-fpga-sheet)
3. [Open Vendor IP components' properties]()

### Documentation tab

4. Update the Instance name of the vendor IP
5. Optional: set the IP Tag
6. Optional: Add any information about the IP

### Clocking tab

7. Left click on Clocking tab
8. Change the name of existing clock port if desired
9. Change the direction of existing clock if desired
10. Left click on **+ Add Clock Port** button to add more clocks

### Ports tab

11. Left click on Ports tab
12. Left click on **+ Add Port**

> **Response**
> - A new row is added to define the port

13. Update name of port
14. Set the side the port should appear on the component
15. Select protocol for port
16. Select role of port
17. Select component clock defined in previous steps to port
18. Repeat until all ports are created

### Resources tab

Setting the resources the Vendor IP uses allows the component to be used when determining if the logic will fit in the device.

19. Left click on Resources tab
20. Select vendor
21. Select family

> **Response**
> - All the resource properties for the vendor and family are displayed

22. Fill out the amount of resources the Vendor IP takes
23. Add a reference indicating where the resources were derived from

### BSP tab

Indicating if the Vendor IP includes registers allows for cataloging interfaces for software.
A list of components that require software interaction can then be given to software.

24. Check the box if the Vendor IP includes registers
25. Optional:  Indicate what driver can be used to access any registers in the Vendor IP

26. Left click **Save** button

> **Response**
> - Properties window closes
> - Ports on the component are added

### Sheet

27. Vertically adjust the size of the component
28. Move ports as needed
29. Right click component
30. Select **Add to Library...**

> **Response**
> - Add to Library window is displayed

31. Select category to save the Vendor IP in
32. Left click **Add to Library**

> **Response**
> - Vendor IP component is added to group in Component Library

# Tasks

## Deployment Diagram

### Open Deployment Diagram

1. Left click **Visualations** menu item
2. Left click **Deployment Diagram**

> **Response**
> - Deployment diagram is displayed

## Clocking

### Create Clock Ports on Components

1. [Open component clocking tab](#open-component-clocking-tab)
2. Left click on the **+ Add Clock Port** button
3. Change the name of the clock port
4. Set the direction of the clock
5. Left click **Save** button

### Assign Clocks to Components

1. [Open clock diagram](#open-clock-diagram)
2. Left click on sink clock
3. Drag sink clock to the source clock

> **Response**
> - Sink clock is moved under the source clock
> - Sink clock is indented
> - Clock diagram updates

4. Repeat assignments until all sink clocks have been assigned
5. Left click **Close** button

### Bind a Component's Clock to a Component's Port or Protocol

This task allows the user to indicate the clock domain of a port or protocol relative to its defined clocks.
This is necessary to communicate to users how to properly connect a port or protocol.
This will also be used when generating documentation.

1. [Open component ports tab](#open-component-ports-tab)
2. Pick clock for the port or protocol from drop down menu of clocks on that component

> **Response**
> - Selected clock is shown bound to the port   

### Open Component Ports Tab

1. [Open component properties](#open-component-properties)
2. Left click on the Ports tab

> **Response**
> - Defined ports and protocols are displayed

### Open Component Clocking Tab

1. [Open component properties](#open-component-properties)
2. Left click on the Clocking tab

> **Response**
> - Defined clock ports are displayed

### Open Clock Diagram

1. Left click on FPGA sheet in sheet navigation bar
2. Left click on **Clocks & Resets** menu item

> **Response**
> - Clock Assignments and Clock Diagram window is displayed
> - Clock Assignments are on the left side of the window
> - Clock Diagram is on the right side of the window
> - Clock Diagram will show any components that have their source or sink clocks assigned
> - Clock Diagram will not show a component if its source or sink clocks have not been assigned

## Resource Utilization

### Add Resources To Vendor IP, RTL, or Register File Component

1. [Go to Resources tab](#go-to-resources-tab)
2. Select Vendor
3. Select Family

> **Response**
> - The resource types available will be displayed based on the Vendor and Family

4. Update Resource types
5. Add reference of where the resources were derived
6. Click Save

### View FPGA Utilization

1. Left click **Visualizations**
2. Left click **Resource Utilization**

> **Response**
> - The resource utilization for each FPGA is displayed
> - Each type of resource for each FPGA is displayed

## Navigation

### Go to Resources tab

1. [Open Component Properties](#open-component-properties)
2. Left click on Resources tab

> **Response**
> - Contents of Resources tab will appear

### Open Component Properties

1. Right Click on Component
2. Select **Edit Properties...** from menu

> **Response**
> - Properties window will appear

### Open CCA Component Sheet

1. Double click on CCA component

> **Response**
> - CCA sheet of component double clicked on appears

### Open FPGA Component Sheet

1. Double click on FPGA component

> **Response**
> - FPGA sheet of component double clicked on appears

## Block Diagram

### Move a Single Port on Component to Other Side of Component

1. Right Click on a Port
2. Select **Move to other side**

> **Response** 
> - If the port is on the left side of the component, it will be moved to the right side of the component
> - If the port is on the right side of the component, it will be moved to the left side of the component
> - If the port is on a CCA component, the port on its CCA sheet will move from one CONN column to the other CONN column
> - If the port is on an FPGA component, the port on its FPGA sheet will move from one Interfaces column to the other Interfaces column
> - If the port is on a Subsystem component, the port on its Subsystem sheet will move from one EXT column to the other EXT column

### Remove a Column from a sheet

1. Right Click on column to remove
2. Select **Remove Column**

> **Response**
> - Selected column is removed from sheet

### Add a Column to a sheet

1. Right Click on gutter where new column should appear
2. Select **Add Column**

> **Response**
> - New column added to the right of the gutter

## System Sheet

### Add a CCA Component to the System Sheet

1. Right Click on a column in the system sheet
2. Mouse over **Add Component**
3. Select **CCA**

> **Response**
> - CCA component added to column where the right click occured
> - CCA sheet created with the name of the CCA component
> - CCA sheet navigation button added to sheet navigation bar with the name of the CCA component

## Sheets

### Create a connection between to components

1. Left click on first component
2. CTRL+Left click the second component

> **Response**
> - Port created on first component
> - Port created on second component
> - Line created between first and second port
> - Ports are aligned vertically so the line is horizontal

### Create a connection between a component and a boundary port

1. Left click on boundary port
2. Left click on component

> **Response**
> - Port created on component
> - Line created between component and external port
> - Ports are aligned vertically so the line is horizontal

### Create a connection between two ports

1. Left click on first port
2. Left click on second port

> **Response**
> - Line created between first and second port
> - Ports are aligned vertically so the line is horizontal

### Open a Subsystem Sheet

1. Double click on the subsystem component

> **Response**
> - Subsystem sheet for the component is presented

### Add Component From Component Library

1. Navigate to component in component library
2. Left click an hold component to add to sheet
3. Drag component to a column
4. Let go of left mouse button

> **Response**
> - Component selected from component library is placed in column selected

### Create port on sheets' Component

1. Right Click on boundary margin
2. Left Click **Edit Boundary Ports...*

> **Response**
> - Components Edit Properties window Ports tab is displayed

## CCA Sheet

### Add a Hardware Component to the CCA Sheet

1. Right Click on a column in the CCA sheet
2. Mouse over **Add Component**
3. Select **HW**

> **Response**
> - HW component added to column where the right click occured

### Add an FPGA Component to the CCA Sheet

1. Right Click on a column in the CCA sheet
2. Mouse over **Add Component**
3. Select **FPGA**

> **Response**
> - FPGA component added to column where the right click occured
> - FPGA sheet created with the name of the FPGA component
> - FPGA sheet navigation button added to the sheet navigation bar with the name of the FPGA component and to the right of the CCA the FPGA is located on

## FPGA Sheet

### Add a Hard Macro Component to the FPGA Sheet

1. Right Click on a column in the FPGA sheet
2. Mouse over **Add Component**
3. Select **Hard Macro**

> **Response**
> - Hard Macro component added to column where the right click occured

### Add a Vendor IP Component to the FPGA Sheet

1. Right Click on a column in the FPGA sheet
2. Mouse over **Add Component**
3. Select **Vendor IP**

> **Response**
> - Vendor IP component added to column where the right click occured

### Add an RTL Component to the FPGA Sheet

1. Right Click on a column in the FPGA sheet
2. Mouse over **Add Component**
3. Select **RTL**

> **Response**
> - RTL component added to column where the right click occured

### Add a Subsystem Component to the FPGA Sheet

1. Right Click on a column in the FPGA sheet
2. Mouse over **Add Component**
3. Select **Subsystem**

> **Response**
> - Subsystem component added to column where the right click occured
> - Subsystem sheet created with the name of the Subsystem component
> - Subsystem sheet navigation button added to the sheet navigation bar with the name of the Subsystem component and to the right of FPGA it is located in

# Feature Mapping

Feature Mapping is a concept that traces a feature through the hierarchy.
Feature Mapping combines Feature Arcs and the wiring of ports in the design to build a complete sequence of events.
It presents a holistic view of which components are involved in the feature.
The process honors hierarchy to ensure where in the design components are located.

## Feature Arcs

Feature Arcs define the behavior of a component relative to its inputs and outputs.
The types of Feature Arcs are named by their relationship to a components inputs and outputs listed in the table below:

| Feature Arc Name | Input Port | Output Port |
|------------------|------------|-------------|
| Consumer         |    Yes     |     No      |
| Internal         |     No     |     No      |
| Originator       |     No     |    Yes      |
| Passthrough      |    Yes     |    Yes      |

All Feature Arcs are defined to use maximum of one input port and/or one output port.

### Consumer

This type of Feature Arc represents a component's response to a pertubation that is not visible outside the component.
For example, a counter is updated when a component receives an Ethernet packet.

### Internal

This type of Feature Arc has not been defined at this moment.
A use for this type has not been determined.

### Originator

This type of Feature Arc represents the start of a feature.
For example, a processor component writes data to a register.

### Passthrough (there must be a better name.  Any suggestions would be appreciated.)

This type of Feature Arc represents something perturbing a component and its external response.
For example, a disrete input is asserted on a components input port, then the component asserts an interrupt on one of its output ports.

## Implementation Requirements

### Rendering Requirements

The following are the rendering implementation requirements

[REQ] REND.1 : Only feature defined at the sheet currently being viewed will be available for rendering

[REQ] REND.2 : Feature Arcs defined on components will not be available for rendering

[REQ] REND.3 : After a feature is selected for rendering, only the upper most components will be rendered

[REQ] REND.4 : Double clicking a CCA, FPGA, or Subsystem component will expand that components hierarchy

[REQ] REND.5 : Objects at the same level of hierarchy shall be rendered at the same Y location

#### Activations

Activations are not modeled.

#### Actors

Actors are not modeled.

#### Combined Fragment

Combinded Fragments are not modeled.

#### Expanded Objects 

Expanded Objects are not defined in UML.
This is a new concept, as far as I can tell, that allows for hierarchical representation of sequence diagrams.

[REQ] EO.1 : The header of the expanded Object shall be rendered at the same Y location as other Objects at the same level of hierarchy

[REQ] EO.2 : The box denoting the expanded Object shall fully contain all Objects in the Expanded Object

[REQ] EO.3 : The box denoting the expanded Object shall fully contain all lifelines of Objects in the Expanded Object

[REQ] EO.4 : The box donoting the expanded Object shall fully contain the boxes of expanded Objects in the Expanded Object

[REQ] EO.5 : The rendered lines of all Expanded Objects shall not overlap

[REQ] EO.6 : The rendered lines of all Expanded Objects shall be separated by a minimum of [TBD] pixels

[REQ] EO.7 : The background color of the expanded Object's header shall be the same color as the background color of the component it represents

[REQ] EO.8 : The text color of the expanded Object's header shall be the same color as the text color of the component it represents

#### Lifelines

Lifelines represent the behavior of the Feature Arcs defined for the Object based on its component
A message entering a life line is entering a port defined on the component.
A message exiting a life line is exiting a port defined on the component.
A message exiting a life line and entering the same life line is entering aport defined on the component and terminating interally to the component.

[REQ] LL.1 : Lifelines shall be rendered as vertical dashedlines

[REQ] LL.2 : Lifelines shall be rendered from the Object to [TBD] pixels past the last message on its life line

#### Message

Messages represent the connections between components in the diagram except in the case of Consumer Feature Arcs.

[REQ] M.1 : A messages shall be rendered horizontally

[REQ] M.2 : A messages shall be rendered as solid lines

[REQ] M.3 : A message arrowhead shall be rendered as a solid color

[REQ] M.4 : An Originator Feature Arc shall be rendered as a message exiting the life line of the object the Feature Arc is associated with to the life line of the object associated with the connection of the output port defined by the Originator Feature Arc

[REQ] M.5 : A Passthrough Feature Arc shall be rendered as a message exiting the life line of the object the Feature Arc is associated with to the life line of the object associated with the connection of the output port defined by the Passthrough Feature Arc

[REQ] M.6 : A Consumer Feature Arc shall be rendered as a message exiting the life line of the object the Feature Arc is associated with back to the same life line of the object

#### Objects

Objects are equivalent to components in this implementation.

[REQ] O.1 : The Objects background color shall match the background color of the component it represents

[REQ] O.2 : The Objects text color shall match the text color of the component it represents


# Acronyms

ADC : Analog Digital Converter

CCA : Circuit Card Assembly

DAC : Digital Analog Converter

FPGA : Field Programmable Gate Array

HW : Hardware

LRU : Line Replaceable Unit

# Definitions

bind
: An assignment of two elements of a component

boundary margin
: The left and right most columns of a sheet where the sheets components ports are placed.

bread crumb bar
: A representation of where the current sheet is located in the hierarchy

clock diagram
: A graphical view of clock sources and clock sinks

column
: An area of sheet where components can be placed

component
: An object that represents a physical part of the FPGA, a piece of hardware on a CCA, or the CCA itself.

deployment diagram
: A diagram that shows components of a system in a hierarchical view

gutter
: An area between columns where no components can be placed

hard macro
: A part of the FPGA that provides a function that is not part of the programmable logic
Examples include processor subsystems, PCIe cores, and InterLaken cores.

menu bar
: A row at the top of the application that behaves like a traditional menu bar

sheet
: A view that allows components to be added to it

sheet navigation bar
: An area at the top of the application that contains a link to every sheet in the system

subsystem
: An object that acts like a container that can include a limited set of other components
